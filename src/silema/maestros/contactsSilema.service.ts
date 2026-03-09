import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class contactsSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncContactsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts?$filter=processHit eq true`;
    let res = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain contacts');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        const contacto = {
          Id: `CliBoti_000_${res.data.value[i].id}` || '',
          Nom: res.data.value[i].name || '',
          Telefon: res.data.value[i].phoneNo || '',
          Adreca: res.data.value[i].address || '',
          emili: res.data.value[i].eMail || '',
          Nif: res.data.value[i].vatRegistrationNo || '',
          IdExterna: res.data.value[i].loyaltyNo || '',
          idBc: res.data.value[i].id || '',
          numberBc: res.data.value[i].number || '',
        };

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'contacto'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (querySincro.recordset.length == 0) {
            let sqlInserted = false;
            let checks = [
              `SELECT * FROM clientsFinals WHERE IdExterna = '${contacto.IdExterna}'`,
              `SELECT * FROM clientsFinals WHERE emili = '${contacto.emili}'`,
              `SELECT * FROM clientsFinals WHERE Telefon = '${contacto.Telefon}'`,
              `SELECT * FROM clientsFinals WHERE Telefon = '${contacto.Telefon}' AND emili = '${contacto.emili}' AND IdExterna = '${contacto.IdExterna}'`,
              `SELECT * FROM clientsFinals WHERE Id = '${contacto.Id}'`,
            ];

            for (let sqlCheck of checks) {
              let queryCheck = await this.sql.runSql(sqlCheck, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                await this.insertarContacto(contacto, token, database, companyID, tenant, entorno);
                sqlInserted = true;
              }
            }

            if (!sqlInserted) {
              console.log('El cliente ya existe en la base de datos');
              let sqlGetCodi = `SELECT TOP 1 Id FROM clientsFinals WHERE IdExterna = '${contacto.IdExterna} OR emili = '${contacto.emili}' OR Telefon = '${contacto.Telefon}'`;
              let queryGetCodi = await this.sql.runSql(sqlGetCodi, database);
              if (queryGetCodi.recordset.length > 0) {
                contacto.Id = queryGetCodi.recordset[0].Id;
                console.log(`Codi encontrado: ${contacto.Id}`);
              } else {
                console.log('No se ha encontrado el cliente en la base de datos');
                continue;
              }
              await this.actualizarContacto(2, contacto, token, database, companyID, tenant, entorno);
            }
          } else {
            await this.actualizarContacto(1, contacto, token, database, companyID, tenant, entorno);
          }
        } catch (error) {
          console.error(`Error al sincronizar el contacto: ID=${contacto.idBc}, Nombre=${contacto.Nom}, CompanyID=${companyID}`);
          console.error(error);
          continue;
        }
      }
      console.log(`Synchronizing contacts... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async insertarContacto(contacto, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO clientsFinals 
    (Id, Nom, Telefon, Adreca, emili, Nif, IdExterna) VALUES
    ('${contacto.Id}', '${this.escapeSqlString(contacto.Nom)}', '${contacto.Telefon}', '${this.escapeSqlString(contacto.Adreca)}', '${this.escapeSqlString(contacto.emili)}', '${contacto.Nif}', '${contacto.IdExterna}')`;

    let tipoDato = 'contacto';

    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit)
    VALUES (GETDATE(), '${tipoDato}', '${contacto.numberBc}', '${contacto.Id}', '${companyID}', '${database}')`;

    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      await this.marcarProcesado(contacto.idBc, token, companyID, tenant, entorno);
      console.log('Contacto procesado');
    } catch (error) {
      console.error(`Error insertar el contacto: ID=${contacto.idBc}, Nombre=${contacto.Nom}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async actualizarContacto(accion, contacto, token, database, companyID, tenant, entorno) {
    try {
      let sqlUpdate = `UPDATE clientsFinals SET 
        Nom = '${this.escapeSqlString(contacto.name)}',
        Telefon = '${contacto.phoneNo}',
        Adreca = '${this.escapeSqlString(contacto.address)}',
        emili = '${this.escapeSqlString(contacto.eMail)}',
        Nif = '${contacto.vatRegistrationNo}',
        IdExterna = '${contacto.loyaltyNo}'
        WHERE Id = '${contacto.id}';`;
      if (accion == 1) {
        await this.sql.runSql(sqlUpdate, database);
        await this.marcarProcesado(contacto.idBc, token, companyID, tenant, entorno);
        console.log('Contacto actualizado');
      } else if (accion == 2) {
        let tipoDato = 'contacto';
        let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit)
        VALUES (GETDATE(), '${tipoDato}', '${contacto.numberBc}', '${contacto.Id}', '${companyID}', '${database}')`;
        await this.sql.runSql(sqlUpdate, database);
        await this.sql.runSql(sqlSincroIds, database);
        await this.marcarProcesado(contacto.idBc, token, companyID, tenant, entorno);
        console.log('Contacto actualizado');
      }
    } catch (error) {
      console.error(`Error al actualizar el contacto: ID=${contacto.idBc}, Nombre=${contacto.Nom}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async marcarProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar el contacto como procesado: ID=${id}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
