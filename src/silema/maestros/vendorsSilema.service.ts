import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class vendorsSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncVendorsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors?$filter=processHit eq true`;
      res = await axios.get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
    } catch (error) {
      console.error(`Error al obtener los proveedores desde Silema: ${error.message},${error.response ? ' Response: ' + JSON.stringify(error.response.data) : ''}`);
      return false;
    }

    if (res.data.value.length == 0) {
      console.log('[Vendors Sync] No hay proveedores para sincronizar.');
      return true;
    }

    for (let i = 0; i < res.data.value.length; i++) {
      let bcrecord = res.data.value[i];
      if (!bcrecord.number || !bcrecord.name || !bcrecord.vatRegistrationNo) {
        console.warn(`[Vendors Sync] Saltando registro ${i} por falta de campos obligatorios (Número o Nombre o NIF). BC ID: ${bcrecord.id}`);
        continue;
      }
      if (bcrecord.processHIT) {
        const proveedor = {
          idBC: bcrecord.id || '',
          nombre: bcrecord.name || '',
          nif: bcrecord.vatRegistrationNo || '',
          direccion: bcrecord.address || '',
          cp: bcrecord.postCode || '',
          ciudad: bcrecord.city || '',
          provincia: bcrecord.county || '',
          pais: bcrecord.countryRegionCode || '',
          tlf1: bcrecord.phoneNo || '',
          tlf2: bcrecord.mobilePhoneNo || '',
          alta: bcrecord.systemCreatedAt ? new Date(bcrecord.systemCreatedAt).toISOString().slice(0, 19).replace('T', ' ') : null,
          activo: 1,
          eMail: bcrecord.eMail || '',
          codi: bcrecord.number || '',
          FormaPago: bcrecord.paymentMethodCode || '',
          FormaPagoValor: 0,
          vencimiento: bcrecord.paymentTermsCode || '',
          id: bcrecord.id || '', // Inicialmente igual, pero se actualizará con el ID de HIT si existe
        };

        //1= Domiciliación, 2=Cheque, 3=Efectivo, 4=Transferencia, 5=Pago bloqueado, 6=Tarjeta

        const formaPagoMap = {
          PROV_CHEQU: 2,
          PROV_DOM: 1,
          PROV_REM_20: 1,
          PROV_TR_CON: 4,
          PROV_TRANS: 4,
        };
        proveedor.FormaPagoValor = formaPagoMap[proveedor.FormaPago] || 0;

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${this.escapeSqlString(proveedor.codi)}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'proveedor'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (proveedor.cp.length <= 5) {
            if (querySincro.recordset.length == 0) {

              let sqlFindCandidates = `SELECT * FROM ccProveedores WHERE nif = '${this.escapeSqlString(proveedor.nif)}'`;
              let queryCandidates = await this.sql.runSql(sqlFindCandidates, database);
              let candidateCodes = queryCandidates.recordset.map((r) => r.codi);
              if (candidateCodes.length > 0) {
                console.log(`Se han encontrado ${candidateCodes.length} proveedores para el NIF ${proveedor.nif}: ${candidateCodes.join(', ')}`);
                for (let iCode = 0; iCode < candidateCodes.length; iCode++) {
                  proveedor.codi = candidateCodes[iCode];
                  // El primero crea el vínculo (accion 2), los demás solo se actualizan (accion 1)
                  await this.actualizarProveedor(iCode === 0 ? 2 : 1, proveedor, token, database, companyID, tenant, entorno);
                }
              } else {
                // No existe ningún proveedor para este NIF. Insertamos nuevo proveedor y vinculamos.
                await this.insertarProveedor(proveedor, token, database, companyID, tenant, entorno);
              }
            } else {
              let linkedCodi = querySincro.recordset[0].IdHit;
              proveedor.id = linkedCodi;
              await this.actualizarProveedor(1, proveedor, token, database, companyID, tenant, entorno);

              let sqlFindOthers = `SELECT Id FROM ccProveedores WHERE nif = '${this.escapeSqlString(proveedor.nif)}' AND id <> '${this.escapeSqlString(linkedCodi)}'`;
              let queryOthers = await this.sql.runSql(sqlFindOthers, database);
              for (let row of queryOthers.recordset) {
                proveedor.id = row.Id;
                await this.actualizarProveedor(1, proveedor, token, database, companyID, tenant, entorno);
              }
            }
          }
        } catch (error) {
          console.error(`[Vendors Sync] Error al procesar el vendor ${proveedor.codi} [${proveedor.nombre}]: ${error.message}`);
        }
      }
      console.log(`Synchronizing vendors... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async insertarProveedor(proveedor, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO ccProveedores 
                      (id, nombre, nombreCorto, nif, direccion, cp, ciudad, provincia, pais, tlf1, tlf2, alta, activo, eMail, codi, tipoCobro) 
                      VALUES (
                        '${this.escapeSqlString(proveedor.idBC)}', 
                        '${this.escapeSqlString(proveedor.nombre)}', 
                        '${this.escapeSqlString(proveedor.nombre)}', 
                        '${this.escapeSqlString(proveedor.nif)}', 
                        '${this.escapeSqlString(proveedor.direccion)}', 
                        '${this.escapeSqlString(proveedor.cp)}', 
                        '${this.escapeSqlString(proveedor.ciudad)}', 
                        '${this.escapeSqlString(proveedor.provincia)}', 
                        '${this.escapeSqlString(proveedor.pais)}', 
                        '${this.escapeSqlString(proveedor.tlf1)}', 
                        '${this.escapeSqlString(proveedor.tlf2)}', 
                        '${this.escapeSqlString(proveedor.alta)}', 
                        ${proveedor.activo}, 
                        '${this.escapeSqlString(proveedor.eMail)}', 
                        '${this.escapeSqlString(proveedor.codi)}', 
                        '${proveedor.FormaPagoValor}'
                      );`;

    let tipoDato = 'proveedor';

    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) 
      VALUES (GETDATE(), '${tipoDato}', '${this.escapeSqlString(proveedor.codi)}', '${this.escapeSqlString(proveedor.idBC)}', '${companyID}', '${database}')`;

    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (proveedor.vencimiento && proveedor.vencimiento != '') await this.sqlProveedoresExtes(proveedor.idBC, 'VencimientoDias', proveedor.vencimiento, 2, database);
      await this.marcarProcesado(proveedor.idBC, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`[Vendors Sync] Error al insertar el vendor: ID BC=${proveedor.idBC}, Nombre=${proveedor.nombre}. ${error.message}`);
    }
  }

  async actualizarProveedor(accion, proveedor, token, database, companyID, tenant, entorno) {
    try {
      // De momento no quieren que se actualicen los proveedores
      if (accion == 2) {
        let tipoDato = 'proveedor';
        let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) 
          VALUES (GETDATE(), '${tipoDato}', '${this.escapeSqlString(proveedor.codi)}', '${this.escapeSqlString(proveedor.id)}', '${companyID}', '${database}')`;
        await this.sql.runSql(sqlSincroIds, database);
      }
      await this.marcarProcesado(proveedor.idBC, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`[Vendors Sync] Error al actualizar el vendor ${proveedor.codi} [${proveedor.nombre}]: ${error.message}`);
    }
  }
  async sqlProveedoresExtes(Codi, Variable, Valor, query, database) {
    /*
    query = 1 //SELECT
    query = 2 //INSERT
    query = 3 //UPDATE
    query = 4 //DELETE
    query = 5 //DELETE ALL from Codi
    */
    if (query == 1) {
      let sql = `SELECT * FROM ccProveedoresExtes WHERE id = '${Codi}' and nom = '${Variable}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
      return sqlQuery.recordset.length;
    } else if (query == 2) {
      let sql = `INSERT INTO ccProveedoresExtes (id, nom, valor) VALUES ('${this.escapeSqlString(Codi)}', '${this.escapeSqlString(Variable)}', '${this.escapeSqlString(Valor)}')`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 3) {
      let sql = `UPDATE ccProveedoresExtes SET valor = '${this.escapeSqlString(Valor)}' WHERE id = '${this.escapeSqlString(Codi)}' and nom = '${this.escapeSqlString(Variable)}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 4) {
      let sql = `DELETE FROM ccProveedoresExtes WHERE id = '${this.escapeSqlString(Codi)}' and nom = '${this.escapeSqlString(Variable)}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 5) {
      let sql = `DELETE FROM ccProveedoresExtes WHERE id = '${this.escapeSqlString(Codi)}'`;
      let sqlQuery = await this.sql.runSql(sql, database);
    }
  }

  async marcarProcesado(id, token, companyID, tenant, entorno) {
    try {
      const cleanId = String(id).replace(/{|}/g, '');
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors(${cleanId})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar el vendor como procesado: ID=${id}. ${error.message}${error.response ? ' Response: ' + JSON.stringify(error.response.data) : ''}`);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
