import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
@Injectable()
export class locationSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncLocationSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/locations?$filter=processHit eq true`;
    let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/companyInformation`;
    let res = await axios.get(url1, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain locations');
      });
    let res2 = await axios.get(url2, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    })
      .catch((error) => {
        console.log(`Url ERROR: ${url2}`);
        throw new Error('Failed to obtain company information');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM clients t1 LEFT JOIN clients t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`;
        let queryCodi = await this.sql.runSql(sqlCodi, database);
        let bcrecord = res.data.value[i];
        const location = {
          Codi: queryCodi.recordset[0].codigo_disponible || 0,
          Nom: `T--${bcrecord.code} ${bcrecord.name}` || '',
          Adresa: bcrecord.address || '',
          Ciutat: bcrecord.city || '',
          Cp: bcrecord.postCode || 0,
          NomLlarg: res2.data.value[0].displayName || '',
          eMail: bcrecord.eMail || '',
          phone: bcrecord.phoneNo || '',
          idBc: bcrecord.id || '',
          numberBc: bcrecord.code || '',
          Nif: res2.data.value[0].taxRegistrationNumber || '',
          franquicia: bcrecord.franchised || false,
        };

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${location.numberBc}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'location'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (querySincro.recordset.length == 0) {
            let sqlInserted = false;
            let checks = [`SELECT * FROM clients WHERE Nom like '%--${this.escapeSqlString(location.numberBc)}%' and Nif = '${this.escapeSqlString(location.Nif)}'`];
            for (let sqlCheck of checks) {
              let queryCheck = await this.sql.runSql(sqlCheck, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                await this.insertarLocation(location, token, database, companyID, tenant, entorno);
                sqlInserted = true;
              }
            }
            if (!sqlInserted) {

              // Intentamos obtener el Codi real del cliente en clients
              let sqlGetCodi = `
                SELECT TOP 1 Codi 
                FROM clients 
                WHERE Nom LIKE '%--${this.escapeSqlString(location.numberBc)}%'
                and Nif = '${this.escapeSqlString(location.Nif)}'
              `;
              let resultCodi = await this.sql.runSql(sqlGetCodi, database);

              if (resultCodi.recordset.length > 0) {
                location.Codi = resultCodi.recordset[0].Codi;
              } else {
                console.warn(`No se pudo encontrar el Codi del cliente para actualizar: ${location.Nom}`);
                continue;
              }
              await this.actualizarLocation(2, location, token, database, companyID, tenant, entorno);
            }
          } else {
            location.Codi = querySincro.recordset[0].IdHit;
            await this.actualizarLocation(1, location, token, database, companyID, tenant, entorno);
          }
        } catch (error) {
          console.error(`Error al sincronizar el location: ID=${location.idBc}, Nombre=${location.Nom}, CompanyID=${companyID}`);
          console.error(error);
          continue;
        }
      }
      console.log(`Synchronizing locations... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async insertarLocation(location, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO clients (Codi, Nom, Nif, Adresa, Ciutat, Cp, [Nom Llarg]) VALUES
    (${location.Codi}, '${this.escapeSqlString(location.Nom)}', '${this.escapeSqlString(location.Nif)}', '${this.escapeSqlString(location.Adresa)}', '${this.escapeSqlString(location.Ciutat)}', '${location.Cp}', '${this.escapeSqlString(
      location.NomLlarg,
    )}')`;

    let tipoDato = 'location';

    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit)
      VALUES (GETDATE(), '${tipoDato}', '${location.numberBc}', '${location.Codi}', '${companyID}', '${database}')`;
    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (location.eMail != '') await this.sqlConstantClient(location.Codi, 'eMail', location.eMail, 2, database);
      if (location.phone != '') await this.sqlConstantClient(location.Codi, 'Tel', location.phone, 2, database);
      if (location.franquicia) await this.sqlConstantClient(location.Codi, 'Franquicia', 'Franquicia', 2, database);
      await this.marcarProcesado(location.idBc, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`Error insertar el location: ID=${location.idBc}, Nombre=${location.Nom}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async actualizarLocation(accion, location, token, database, companyID, tenant, entorno) {
    try {
      let sqlUpdate = `UPDATE clients SET 
          Nom = '${this.escapeSqlString(location.Nom)}',
          Nif = '${this.escapeSqlString(location.Nif)}',
          Adresa = '${this.escapeSqlString(location.Adresa)}',
          Ciutat = '${this.escapeSqlString(location.Ciutat)}',
          Cp = '${location.Cp}',
          [Nom Llarg] = '${this.escapeSqlString(location.NomLlarg)}'
          WHERE Codi = ${location.Codi};`;
      if (accion == 1) {
        await this.sqlConstantClient(location.Codi, 'eMail', '', 4, database);
        await this.sqlConstantClient(location.Codi, 'Tel', '', 4, database);
        await this.sqlConstantClient(location.Codi, 'Franquicia', '', 4, database);
        await this.sql.runSql(sqlUpdate, database);
        if (location.eMail) await this.sqlConstantClient(location.Codi, 'eMail', location.eMail, 2, database);
        if (location.phone) await this.sqlConstantClient(location.Codi, 'Tel', location.phone, 2, database);
        if (location.franquicia) await this.sqlConstantClient(location.Codi, 'Franquicia', 'Franquicia', 2, database);
        await this.marcarProcesado(location.idBc, token, companyID, tenant, entorno);
      } else if (accion == 2) {
        let tipoDato = 'location';
        let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit)
           VALUES (GETDATE(), '${tipoDato}', '${location.numberBc}', '${location.Codi}', '${companyID}', '${database}')`;
        await this.sql.runSql(sqlUpdate, database);
        await this.sql.runSql(sqlSincroIds, database);
        await this.sqlConstantClient(location.Codi, 'eMail', '', 4, database);
        await this.sqlConstantClient(location.Codi, 'Tel', '', 4, database);
        await this.sqlConstantClient(location.Codi, 'Franquicia', '', 4, database);
        if (location.eMail != '') await this.sqlConstantClient(location.Codi, 'eMail', location.eMail, 2, database);
        if (location.phone != '') await this.sqlConstantClient(location.Codi, 'Tel', location.phone, 2, database);
        if (location.franquicia) await this.sqlConstantClient(location.Codi, 'Franquicia', 'Franquicia', 2, database);
        await this.marcarProcesado(location.idBc, token, companyID, tenant, entorno);
      }
    } catch (error) {
      console.error(`Error al actualizar el location: ID=${location.idBc}, Nombre=${location.Nom}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
  async sqlConstantClient(Codi, Variable, Valor, query, database) {
    /*
    query = 1 //SELECT
    query = 2 //INSERT
    query = 3 //UPDATE
    query = 4 //DELETE
    query = 5 //DELETE ALL from Codi
    */
    if (query == 1) {
      let sql = `SELECT * FROM constantClient WHERE Codi = ${Codi} and Variable = '${Variable}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
      return sqlQuery.length;
    } else if (query == 2) {
      let sql = `INSERT INTO constantsclient (Codi, Variable, Valor) VALUES ('${Codi}', '${Variable}', '${Valor}')`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 3) {
      let sql = `UPDATE constantsclient SET Valor = '${Valor}' WHERE Codi = ${Codi} and Variable = '${Variable}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 4) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi} and Variable = '${Variable}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 5) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    }
  }

  async marcarProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/locations(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar el almacen como procesado: ID=${id}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
