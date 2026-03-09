import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class itemsSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncItemsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/items?$filter=processHit eq true`;
    let res = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain items');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      //console.log(`Iteracion numero ${i}`)
      if (res.data.value[i].processHIT) {
        let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM articles t1 LEFT JOIN articles t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`;
        let queryCodi = await this.sql.runSql(sqlCodi, database);
        console.log(queryCodi.recordset);
        let sqlIva = `select * from tipusIva where Iva = ${res.data.value[i].vatPercent}`;
        let queryIva = await this.sql.runSql(sqlIva, database);
        const item = {
          idBC: res.data.value[i].id,
          numberBC: res.data.value[i].number,
          codi: queryCodi.recordset[0].codigo_disponible || 0,
          nom: res.data.value[i].displayName ?? 'Nombre de ejemplo',
          preu: res.data.value[i].unitPrice ?? 0,
          preuMajor: res.data.value[i].unitPriceExcludeVAT ?? 0,
          desconte: 1,
          esSumable: res.data.value[i].baseUnitOfMeasureCode === 'KG' ? 0 : 1,
          familia: res.data.value[i].familyDimValue ?? '',
          codiGenetic: queryCodi.recordset[0].codigo_disponible || 0,
          tipoIva: queryIva.recordset.length === 0 ? 6 : queryIva.recordset[0].Tipus || 6,
          noDescontesEspecials: 0, // ?? Producte acabat o no
          noEsVen: res.data.value[i].transferToStore ? true : false, // Si no se transfiere a la tienda, se marca como no vendible
        };

        if (item.familia != '') {
          let sqlFamilia = `SELECT * FROM BC_SincroIds WHERE TipoDato = 'family' and IdBc = '${item.familia}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}'`;
          // console.log(sqlFamilia);
          let queryFamilia = await this.sql.runSql(sqlFamilia, database);
          // console.log(queryFamilia.recordset);
          if (queryFamilia.recordset.length > 0 && queryFamilia.recordset[0].IdHit != null) {
            item.familia = queryFamilia.recordset[0].IdHit;
          } else {
            const codigoFamilia = item.familia.substring(0, 4);
            console.log(`Familia a insertar: ${codigoFamilia}`);
            let sqlGetFamilia = `SELECT Nom FROM families WHERE Nivell = 3 AND Nom like '%${codigoFamilia}%'`;
            let queryGetFamilia = await this.sql.runSql(sqlGetFamilia, database);
            let familiaHit = '';
            console.log(`Familia encontrada: ${queryGetFamilia.recordset}`);
            if (queryGetFamilia.recordset.length > 0) {
              familiaHit = queryGetFamilia.recordset[0]?.Nom || '';
              let sqlInsertFamilia = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), 'family', '${item.familia}', '${familiaHit}', '${companyID}', '${database}')`;
              await this.sql.runSql(sqlInsertFamilia, database);
              item.familia = familiaHit;
            } else {
              console.log(`No se encontró la familia con código ${codigoFamilia} en la base de datos`);
            }
          }
        }
        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${item.numberBC}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'item'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (querySincro.recordset.length == 0) {
            // Insert producte

            let sqlInserted = false;
            let checks = [`SELECT * FROM articles WHERE Codi = '${item.numberBC}'`];
            for (let check of checks) {
              let queryCheck = await this.sql.runSql(check, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                await this.insertarItem(item, token, database, companyID, tenant, entorno);
                sqlInserted = true;
              }
            }
            if (!sqlInserted) {
              console.log(`El item con Codi ${item.numberBC} ya existe en la base de datos, actualizando...`);
              let sqlGetCodi = `SELECT TOP 1 Codi FROM articles WHERE Codi = ${item.numberBC}`;
              let result = await this.sql.runSql(sqlGetCodi, database);
              if (result.recordset.length > 0) {
                item.codi = result.recordset[0].Codi;
                item.codiGenetic = item.codi; // Aseguramos que codiGenetic sea igual a codi
              } else {
                console.log(`No se encontró el Codi ${item.codi} en la base de datos, continuando...`);
                continue;
              }
              await this.actualizarItem(2, item, token, database, companyID, tenant, entorno);
            }
          } else {
            item.codi = querySincro.recordset[0].IdHit;
            item.codiGenetic = item.codi; // Aseguramos que codiGenetic sea igual a codi
            await this.actualizarItem(1, item, token, database, companyID, tenant, entorno);
          }
        } catch (error) {
          console.error(`Error al procesar el item: ${res.data.value[i].number}`);
          console.error(error);
          continue; // Skip to the next item if there's an error
        }
      }
      console.log(`Synchronizing items... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }
  async insertarItem(item, token, database, companyID, tenant, entorno) {
    let codi = '';
    if (this.esNumeroValido(item.numberBC)) {
      codi = item.numberBC;
    } else {
      codi = item.codi;
    }
    let sqlInsert = `INSERT INTO articles (Codi, NOM, PREU, PreuMajor, Desconte, EsSumable, Familia, CodiGenetic, TipoIva, NoDescontesEspecials) VALUES
                    (${codi}, '${this.escapeSqlString(item.nom)}', ${item.preu}, ${item.preuMajor}, ${item.desconte}, ${item.esSumable}, '${this.escapeSqlString(item.familia)}', ${item.codiGenetic}, ${item.tipoIva}, ${item.noDescontesEspecials})`;
    //console.log(sql)
    let TipoDato = 'item';
    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
                        (GETDATE(), '${TipoDato}', '${item.numberBC}', '${codi}', '${companyID}', '${database}')`;
    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (item.transferToStore) {
        let sqlPropietats = `INSERT INTO articlesPropietats (CodiArticle, Variable, Valor) VALUES
      (${item.codi},'NoEsVen', 'on')`;
        await this.sql.runSql(sqlPropietats, database);
      }
      await this.marcarProcesado(item.idBC, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`Error al insertar el item: Codi=${item.codi}, Nombre=${item.nom}`);
      console.error(error);
    }
  }
  async actualizarItem(accion, item, token, database, companyID, tenant, entorno) {
    console.log(`Actualizando item: Codi=${item.codi}, Nombre=${item.nom}, Acción=${accion}`);
    let sqlUpdate = ` UPDATE articles SET
                      NOM = '${this.escapeSqlString(item.nom)}',
                      PREU = ${item.preu},
                      PreuMajor = ${item.preuMajor},
                      Desconte = ${item.desconte},
                      EsSumable = ${item.esSumable},
                      Familia = '${this.escapeSqlString(item.familia)}',
                      CodiGenetic = ${item.codiGenetic},
                      TipoIva = ${item.tipoIva},
                      NoDescontesEspecials = ${item.noDescontesEspecials}
                      WHERE Codi = ${item.codi}; `;
    if (accion === 1) {
      await this.sql.runSql(sqlUpdate, database);
      let sqlPropietatsDel = `DELETE FROM articlesPropietats WHERE CodiArticle = ${item.codi} AND Variable = 'NoEsVen'`;
      await this.sql.runSql(sqlPropietatsDel, database);
      if (item.transferToStore) {
        let sqlPropietats = `INSERT INTO articlesPropietats (CodiArticle, Variable, Valor) VALUES
      (${item.codi},'NoEsVen', 'on')`;
        await this.sql.runSql(sqlPropietats, database);
      }
      await this.marcarProcesado(item.idBC, token, companyID, tenant, entorno);
    } else if (accion === 2) {
      let TipoDato = 'item';
      let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
                         (GETDATE(), '${TipoDato}', '${item.codi}', '${item.codi}', '${companyID}', '${database}')`;
      await this.sql.runSql(sqlUpdate, database);
      await this.sql.runSql(sqlSincroIds, database);
      let sqlPropietatsDel = `DELETE FROM articlesPropietats WHERE CodiArticle = ${item.codi} AND Variable = 'NoEsVen'`;
      await this.sql.runSql(sqlPropietatsDel, database);
      if (item.transferToStore) {
        let sqlPropietats = `INSERT INTO articlesPropietats (CodiArticle, Variable, Valor) VALUES
      (${item.codi},'NoEsVen', 'on')`;
        await this.sql.runSql(sqlPropietats, database);
      }
      await this.marcarProcesado(item.idBC, token, companyID, tenant, entorno);
    }
  }
  async marcarProcesado(id, token, companyID, tenant, entorno) {
    console.log(`Marcando como procesado el item: ID=${id}, CompanyID=${companyID}`);
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/items(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar como procesado el item: ID=${id}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
  esNumeroValido(valor: any): boolean {
    return !isNaN(Number(valor));
  }
}

// let familiaL1 = res.data.value[i].familyDimValue ?? "";
// let familiaL2 = res.data.value[i].subfamilyDimValue ?? "";
// let familiaL3 = res.data.value[i].level3DimValue ?? "";
//console.log("Hay que procesar este producto en HIT")
// Check si hay familia en BC para insertarla en Hit
// El nivel 3 de hit es el nivel 1 de BC
// if (res.data.value[i].familyDimValue !== "" && res.data.value[i].subfamilyDimValue !== "" && res.data.value[i].level3DimValue !== "") {
//   // Familia N1
//   this.checkFamilia(familiaL1, 'Article', 1, database)
//   // Familia N2
//   this.checkFamilia(familiaL2, familiaL1, 2, database)
//   // Familia N3
//   this.checkFamilia(familiaL3, familiaL2, 3, database)
// }
// async checkFamilia(NomFamilia, NomPare, Level, database) {
//   let sqlFamilia = `SELECT * FROM [families] WHERE Nom = '${NomFamilia}'`;
//   let queryFamilia = await this.sql.runSql(sqlFamilia, database)
//   if (queryFamilia.recordset.length == 0) {
//     let sqlInsert = `INSERT INTO families (Nom, Pare, Nivell) VALUES ('${NomFamilia}', '${NomPare}', ${Level});`;
//     let recordsInsert = await this.sql.runSql(sqlInsert, database);
//   }
// }
