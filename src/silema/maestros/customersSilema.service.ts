import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class customersSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  // Hay que sincronizar primero los clientes finales (contacts) antes que los clientes (customers)
  async syncCustomersSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers?$filter=processHit eq true`;
      res = await axios.get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
    } catch (error) {
      console.error(`Error al obtener los customers desde Silema: ${error.message},${error.response ? ' Response: ' + JSON.stringify(error.response.data) : ''}`);
      return false;
    }

    if (res.data.value.length == 0) {
      console.log('[Customer Sync] No hay clientes para sincronizar.');
      return true;
    }

    for (let i = 0; i < res.data.value.length; i++) {
      let bcrecord = res.data.value[i];
      if (bcrecord.processHIT) {
        if (!bcrecord.number || !bcrecord.name || !bcrecord.vatRegistrationNo) {
          console.warn(`[Customer Sync] Saltando registro ${i} por falta de campos obligatorios (Número o Nombre o NIF). BC ID: ${bcrecord.id}`);
          continue;
        }

        let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM clients t1 LEFT JOIN clients t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`;
        let queryCodi = await this.sql.runSql(sqlCodi, database);

        // console.log(`Cliente a procesar: ${bcrecord.number}`)
        const customer = {
          Codi: queryCodi.recordset[0].codigo_disponible || 0, // Número convertido a entero o 0 si es inválido
          Nom: bcrecord.name || '', // Nombre o cadena vacía
          Nif: bcrecord.vatRegistrationNo || '', // CIF/NIF o cadena vacía
          Adresa: bcrecord.address || '', // Dirección o cadena vacía
          Ciutat: bcrecord.city || '', // Ciudad o cadena vacía
          Cp: parseInt(bcrecord.postCode) || 0, // Código postal como entero o 0
          Provincia: bcrecord.county || '',
          NomLlarg: bcrecord.name || '', // Nombre largo concatenado
          eMail: bcrecord.eMail || '',
          phone: bcrecord.phoneNo || '',
          FormaPago: bcrecord.paymentMethodCode || '',
          FormaPagoValor: 0,
          Vencimiento: bcrecord.paymentTermsCode || '',
          pagaEnTienda: bcrecord.payInStore ?? true,
          IdBc: bcrecord.id || '',
          numberBC: bcrecord.number || '',
          Lliure: '',
          TipusIva: 1,
          PreuBase: 1,
          DesconteProntoPago: 0,
          Desconte1: 0,
          Desconte2: 0,
          Desconte3: 0,
          Desconte4: 0,
          Desconte5: 0,
          AlbaraValorat: 'NULL',
        };
        //Comprobar que paymentMethodCode es
        // 1= Domiciliación, 2=Cheque, 3=Efectivo, 4=Transferencia
        const formaPagoMap = {
          CLI_TRANSF: 4,
          REMESA: 1,
          REMESA_D20: 1,
        };
        customer.FormaPagoValor = formaPagoMap[customer.FormaPago] || 0;

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${customer.numberBC}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'customer'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (querySincro.recordset.length == 0) {
            // Buscamos todos los clientes candidatos para este NIF (ignorando tiendas)
            let sqlFindCandidates = `SELECT Codi FROM clients WHERE Nif = '${customer.Nif}' AND Codi NOT IN (SELECT Codi FROM ParamsHw)`;
            let queryCandidates = await this.sql.runSql(sqlFindCandidates, database);
            let candidateCodes = queryCandidates.recordset.map((r) => r.Codi);

            if (candidateCodes.length > 0) {
              console.log(`Se han encontrado ${candidateCodes.length} clientes para el NIF ${customer.Nif}: ${candidateCodes.join(', ')}`);
              for (let iCode = 0; iCode < candidateCodes.length; iCode++) {
                customer.Codi = candidateCodes[iCode];
                // El primero crea el vínculo (accion 2), los demás solo se actualizan (accion 1)
                await this.actualizarCustomer(iCode === 0 ? 2 : 1, customer, token, database, companyID, tenant, entorno);
              }
            } else {
              // No existe ningún cliente para este NIF. Insertamos nuevo cliente y vinculamos.
              await this.insertarCustomer(customer, token, database, companyID, tenant, entorno);
            }
          } else {
            let linkedCodi = querySincro.recordset[0].IdHit;
            // Actualizamos el vinculado
            customer.Codi = linkedCodi;
            await this.actualizarCustomer(1, customer, token, database, companyID, tenant, entorno);

            // También buscamos otros posibles clientes con el mismo NIF para mantenerlos sincronizados
            let sqlFindOthers = `SELECT Codi FROM clients WHERE Nif = '${customer.Nif}' AND Codi != ${linkedCodi} AND Codi NOT IN (SELECT Codi FROM ParamsHw)`;
            let queryOthers = await this.sql.runSql(sqlFindOthers, database);
            for (let row of queryOthers.recordset) {
              customer.Codi = row.Codi;
              await this.actualizarCustomer(1, customer, token, database, companyID, tenant, entorno);
            }
          }
        } catch (error) {
          console.error('Error al procesar el cliente:', error.message);
          continue;
        }
      }
      console.log(`Synchronizing customers... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }

    return true;
  }

  async insertarCustomer(customer, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO clients 
              (Codi, Nom, Nif, Adresa, Ciutat, Cp, [Nom Llarg], Lliure, [Tipus Iva], [Preu Base], [Desconte ProntoPago], [Desconte 1], [Desconte 2], [Desconte 3], [Desconte 4], [Desconte 5], AlbaraValorat) VALUES
              (${customer.Codi}, 
              '${this.escapeSqlString(customer.Nom)}', 
              '${customer.Nif}', 
              '${this.escapeSqlString(customer.Adresa)}', 
              '${this.escapeSqlString(customer.Ciutat)}', 
              '${customer.Cp}', 
              '${this.escapeSqlString(customer.NomLlarg)}',
              '${customer.Lliure}',
              ${customer.TipusIva},
              ${customer.PreuBase},
              ${customer.DesconteProntoPago},
              ${customer.Desconte1},
              ${customer.Desconte2},
              ${customer.Desconte3},
              ${customer.Desconte4},
              ${customer.Desconte5},
              ${customer.AlbaraValorat})`;
    let TipoDato = 'customer';

    let sqlSincroIds = `INSERT INTO BC_SincroIds 
            (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), '${TipoDato}', '${customer.numberBC}', '${customer.Codi}', '${companyID}', '${database}')`;
    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (customer.eMail != '') await this.sqlConstantClient(customer.Codi, 'eMail', customer.eMail, 2, database);
      if (customer.phone != '') await this.sqlConstantClient(customer.Codi, 'Tel', customer.phone, 2, database);
      if (customer.FormaPagoValor) await this.sqlConstantClient(customer.Codi, 'FormaPagoLlista', customer.FormaPagoValor, 2, database);
      if (!customer.pagaEnTienda) await this.sqlConstantClient(customer.Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database);
      if (customer.Vencimiento != '') await this.sqlConstantClient(customer.Codi, 'Venciment', customer.Vencimiento, 2, database);
      if (customer.Provincia != '') await this.sqlConstantClient(customer.Codi, 'Provincia', customer.Provincia, 2, database);
      await this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`Error al insertar el cliente: ${error.message}`);
    }
  }
  async actualizarCustomer(accion, customer, token, database, companyID, tenant, entorno) {
    try {
      // Checkear si el cliente es una tienda (ParamsHw)
      let sqlCheckTienda = `SELECT Codi FROM ParamsHw WHERE Codi = ${customer.Codi}`;
      let queryTienda = await this.sql.runSql(sqlCheckTienda, database);
      if (queryTienda.recordset.length > 0) {
        console.log(`El Codi ${customer.Codi} es una tienda (ParamsHw). Se omite el update de datos de cliente.`);
        await this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
        return;
      }

      // Buscar datos actuales del cliente
      let sqlGetCurrent = `SELECT Nom, Nif, Adresa, Ciutat, Cp, [Nom Llarg] FROM clients WHERE Codi = ${customer.Codi}`;
      let queryCurrent = await this.sql.runSql(sqlGetCurrent, database);

      if (queryCurrent.recordset.length > 0) {
        let current = queryCurrent.recordset[0];
        let updates = [];

        if (this.escapeSqlString(customer.Nom) !== this.escapeSqlString(current.Nom)) updates.push(`Nom = '${this.escapeSqlString(customer.Nom)}'`);
        if (customer.Nif !== current.Nif) updates.push(`Nif = '${customer.Nif}'`);
        if (this.escapeSqlString(customer.Adresa) !== this.escapeSqlString(current.Adresa)) updates.push(`Adresa = '${this.escapeSqlString(customer.Adresa)}'`);
        if (this.escapeSqlString(customer.Ciutat) !== this.escapeSqlString(current.Ciutat)) updates.push(`Ciutat = '${this.escapeSqlString(customer.Ciutat)}'`);
        if (customer.Cp != current.Cp) updates.push(`Cp = '${customer.Cp}'`);
        if (this.escapeSqlString(customer.NomLlarg) !== this.escapeSqlString(current['Nom Llarg'])) updates.push(`[Nom Llarg] = '${this.escapeSqlString(customer.NomLlarg)}'`);

        if (updates.length > 0) {
          let sqlUpdate = `UPDATE clients SET ${updates.join(', ')} WHERE Codi = ${customer.Codi};`;
          await this.sql.runSql(sqlUpdate, database);
          console.log(`Customer ${customer.Codi} actualizado: ${updates.length} campos cambiados.`);
        } else {
          console.log(`Customer ${customer.Codi} no tiene cambios en la tabla clients.`);
        }

        // Sincronizar campos de constantsclient
        let sqlGetConstants = `SELECT Variable, Valor FROM constantsclient WHERE Codi = ${customer.Codi}`;
        let queryConstants = await this.sql.runSql(sqlGetConstants, database);
        let currentConstants = {};
        queryConstants.recordset.forEach((row) => { currentConstants[row.Variable] = row.Valor; });

        const syncConstant = async (variable, newValue) => {
          let oldValue = currentConstants[variable];
          if (newValue != oldValue) {
            if (oldValue === undefined && newValue !== '' && newValue !== undefined) {
              await this.sqlConstantClient(customer.Codi, variable, newValue, 2, database);
              console.log(`Constant ${variable} insertada: ${newValue}`);
            } else if (newValue !== '' && newValue !== undefined) {
              await this.sqlConstantClient(customer.Codi, variable, newValue, 3, database);
              console.log(`Constant ${variable} actualizada: ${oldValue} -> ${newValue}`);
            } else if (oldValue !== undefined) {
              await this.sqlConstantClient(customer.Codi, variable, '', 4, database);
              console.log(`Constant ${variable} eliminada.`);
            }
          }
        };

        await syncConstant('eMail', customer.eMail);
        await syncConstant('Tel', customer.phone);
        await syncConstant('FormaPagoLlista', customer.FormaPagoValor || '');
        await syncConstant('NoPagaEnTienda', !customer.pagaEnTienda ? 'NoPagaEnTienda' : '');
        await syncConstant('Venciment', customer.Vencimiento);
        await syncConstant('Provincia', customer.Provincia);
      }

      if (accion == 2) {
        let TipoDato = 'customer';
        let sqlSincroIds = `INSERT INTO BC_SincroIds 
            (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), '${TipoDato}', '${customer.numberBC}', '${customer.Codi}', '${companyID}', '${database}')`;
        await this.sql.runSql(sqlSincroIds, database);
      }
      await this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
    } catch (error) {
      console.error(`[Customer Sync] Error al actualizar el cliente ${customer.Codi} [${customer.Nom}]: ${error.message}`);
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
      return sqlQuery.recordset.length;
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

  async marcaProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar el customer como procesado: ID=${id}. ${error.message}`);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
