import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { response } from 'express';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';

@Injectable()
export class trabajadoresService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncTrabajadoresAC(database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const empresas: Array<{ empresaID: string; nombre: string }> = [
      { empresaID: '84290dc4-6e90-ef11-8a6b-7c1e5236b0db', nombre: 'Arrazaos S.L.U' },
      { empresaID: '86ee4d52-801e-ef11-9f88-0022489dfd5d', nombre: 'Filapeña S.L.U' },
      { empresaID: 'fb77685d-6f90-ef11-8a6b-7c1e5236b0db', nombre: 'Horreols S.L.U' },
      { empresaID: 'd2a97ec2-654e-ef11-bfe4-7c1e5234e806', nombre: 'IME Mil S.L.U' },
      { empresaID: 'e60b9619-6f90-ef11-8a6b-7c1e5236b0db', nombre: 'Pomposo S.L.U' },
      { empresaID: 'f81d2993-7e1e-ef11-9f88-000d3ab5a7ff', nombre: 'Silema S.L.U' },
    ];

    for (const empresa of empresas) {
      try {
        let sql = `select * from records where Concepte = 'BC_Dependentes_${empresa.empresaID}'`;
        let query = await this.sql.runSql(sql, database);
        if (query.recordset.length == 0) {
          console.log('No hay registros de sincronización de trabajadores en la base de datos');
          continue;
        }
        console.log(query.recordset[0]);
        const timestampDB = query.recordset[0].TimeStamp;
        console.log(`Timestamp de la base de datos: ${timestampDB}`);
        const timestamp = new Date(timestampDB).toISOString();
        console.log(`TimeStamp: ${timestamp}`);
        const offsetNumber = moment.tz('Europe/Madrid').utcOffset() / 60;
        // Si viene como Date, lo convertimos directamente a ISO con precisión
        const filtro = moment(timestampDB).subtract(offsetNumber, 'hours').utc().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');

        console.log(`Hora convertida (menos ${offsetNumber}h): ${filtro}`);
        console.log(`Sincronizando empresa: ${empresa.nombre}`);
        await this.syncTrabajadores(filtro, empresa.empresaID, database, client_id, client_secret, tenant, entorno);
        let sqlUpdate = `UPDATE records SET timestamp = GETDATE() WHERE Concepte = 'BC_Dependentes_${empresa.empresaID}'`;
        await this.sql.runSql(sqlUpdate, database);
        console.log(`✅ Timestamp actualizado para la empresa ${empresa.nombre}\n............................\n`);
      } catch (error) {
        this.logError(`❌ Error al sincronizar empresa ${empresa.nombre}:`, error);
      }
    }
    return true;
  }

  async syncTrabajadores(filtro, companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/Miguel/365ObradorAPI/v1.0/companies(${companyID})/perceptoresQuery?$filter=systemModifiedAt gt ${filtro}`;
    let res;
    try {
      res = await axios.get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando el trabajadores en BC`, error);
      throw error;
    }
    let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/companyInformation`;
    let res2;
    try {
      res2 = await axios.get(url2, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando la información de la empresa en BC`, error);
      throw error;
    }
    const nifEmpresa = res2.data.value[0].taxRegistrationNumber || '';
    const categoriaTipoGDTMap = {
      AUXADM: 'GERENT_2',
      AUXCOM: 'CONTABILITAT',
      AUXCOMSIL: 'CONTABILITAT',
      AUXE: 'PRODUCCIO',
      CADM: 'GERENT_2',
      CAPVENG: 'DEPENDENTA',
      CAPVENT: 'DEPENDENTA',
      CVENBCN: 'DEPENDENTA',
      CARR: 'DEPENDENTA',
      CPROD: 'PRODUCCIO',
      EPROD: 'PRODUCCIO',
      EVEN: 'GERENT_2',
      G1: 'DEPENDENTA',
      G2: 'DEPENDENTA',
      G4N1: 'DEPENDENTA',
      G4N2: 'DEPENDENTA',
      G6N3: 'DEPENDENTA',
      MEC: 'DEPENDENTA',
      NET: 'NETEJA',
      NETSIL: 'NETEJA',
      OF1A: 'ADMINISTRACIO',
      OF1E: 'ADMINISTRACIO',
      OF1F: 'REPARTIDOR',
      OF2F: 'REPARTIDOR',
      XOFR: 'REPARTIDOR',
      XOFRSIL: 'REPARTIDOR',
      REP: 'REPARTIDOR',
      OF2A: 'ADMINISTRACIO',
      OF2E: 'ADMINISTRACIO',
      PR: 'DEPENDENTA',
      PRES: 'DEPENDENTA',
      VOCAL: 'DEPENDENTA',
      SUP: 'GERENT_2',
      VENBCN: 'DEPENDENTA',
      VENGI: 'DEPENDENTA',
      VENT: 'DEPENDENTA',
      VPRES: 'ADMINISTRACIO',
    };
    let i = 0;
    for (const trabajador of res.data.value) {
      //let sql = `SELECT * FROM dependentes WHERE codi = '${codi}'`;
      let sql = `SELECT * FROM dependentesextes WHERE nom = 'DNI' AND valor = '${trabajador.documento}'`;
      let query = await this.sql.runSql(sql, database);
      let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM dependentes t1 LEFT JOIN dependentes t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`;
      let queryCodi = await this.sql.runSql(sqlCodi, database);
      let codi = queryCodi.recordset[0].codigo_disponible || 0; //Codigo disponible
      let nom = trabajador.apellidosYNombre;
      let memo = trabajador.nombre;
      let adreca = `${trabajador.viaPublica} ${trabajador.numero} ${trabajador.piso}`;
      let icona = '';
      let hiEditemHoraris = 1;
      let tid = '';
      let fechaAlta = this.sanitizeFecha(trabajador.altaContrato) || new Date().toISOString().split("T")[0];
      let fechaAct = this.sanitizeFecha(trabajador.altaContrato) || new Date().toISOString().split("T")[0];
      const tipoGDT = categoriaTipoGDTMap[trabajador.categoria] || 'DEPENDENTA';

      const inserts = [
        { nom: 'ADRESA', valor: adreca },
        { nom: 'CIUTAT', valor: trabajador.poblacion },
        { nom: 'CODIGO POSTAL', valor: trabajador.cp },
        { nom: 'numSS', valor: trabajador.noAfiliacion },
        { nom: 'DNI', valor: trabajador.documento },
        { nom: 'EMAIL', valor: trabajador.email },
        { nom: 'EMPRESA', valor: trabajador.centroTrabajo },
        { nom: 'ID', valor: trabajador.auxiliaryIndex1 },
        { nom: 'NOM', valor: trabajador.apellidosYNombre },
        { nom: 'PROVINCIA', valor: trabajador.auxiliaryIndex3 },
        { nom: 'TLF_MOBIL', valor: trabajador.noTelfMovilPersonal },
        { nom: 'hBase', valor: trabajador.horassemana },
        { nom: 'TIPUSTREBALLADOR', valor: tipoGDT },
        { nom: 'DATACONTRACTEINI0', valor: fechaAlta },
        { nom: 'NIF_EMPRESA', valor: nifEmpresa },
      ];
      if (query.recordset.length == 0) {
        let year = new Date(fechaAlta).getFullYear();
        if (year < 2025) {
          year = new Date().getFullYear();
        }
        console.log(`Trabajador a procesar: ${trabajador.documento}`);
        let sqlInsert = ` INSERT INTO dependentes ( CODI, NOM, MEMO, ADREÇA, Icona, [Hi Editem Horaris], Tid) 
        VALUES ( '${codi}', '${this.escapeSqlString(nom)}', '${this.escapeSqlString(memo)}', '${this.escapeSqlString(adreca)}', '${icona}', ${hiEditemHoraris}, '${tid}'); `;
        await this.sql.runSql(sqlInsert, database);
        if (fechaAlta) {
          let sqlCalendario = `insert into CdpCalendariLaboral_${year} (id, fecha, idEmpleado, estado, observaciones, timestamp) values (NEWID(), '${fechaAlta}', '${codi}', 'INICIO CONTRATO', '', getdate())`;
          await this.sql.runSql(sqlCalendario, database);
        } else {
          console.warn(`⛔ Fecha inválida para trabajador ${trabajador.documento}, no se inserta en calendario.`);
        }
        for (const { nom, valor } of inserts) {
          // Salta la inserción si el valor está vacío, null, undefined o solo espacios
          if (valor == null || valor.toString().trim() === '') continue;

          const safeNom = nom.replace(/'/g, "''");
          const safeValor = valor.toString().replace(/'/g, "''");

          const sql = `
            INSERT INTO dependentesExtes (id, nom, valor)
            VALUES ('${codi}', '${safeNom}', '${safeValor}');
          `;
          await this.sql.runSql(sql, database);
        }
        console.log(`Trabajador creado con dni/codigo: ${trabajador.documento}/${codi}`);
      } else {
        console.log(`Trabajador ya existe, dni/codigo: ${trabajador.documento}`);
        codi = query.recordset[0].id;
        // Actualiza el trabajador existente
        let sqlUpdate = ` UPDATE dependentes SET CODI = '${query.recordset[0].id}', NOM = '${this.escapeSqlString(nom)}', 
        ADREÇA = '${this.escapeSqlString(adreca)}', Icona = '${icona}', [Hi Editem Horaris] = ${hiEditemHoraris}, Tid = '${tid}' WHERE CODI = '${codi}' `;
        await this.sql.runSql(sqlUpdate, database);
        for (const { nom, valor } of inserts) {
          // Salta la inserción si el valor está vacío, null, undefined o solo espacios
          if (!valor?.toString().trim() || ['TIPUSTREBALLADOR', 'TLF_MOBIL', 'EMAIL', 'DATACONTRACTEINI0'].includes(nom)) continue;

          const safeNom = nom.replace(/'/g, "''");
          const safeValor = valor.toString().replace(/'/g, "''");

          //Revisar si existe el registro
          let sqlSelect = `SELECT * FROM dependentesExtes WHERE id = '${codi}' AND nom = '${safeNom}'`;
          let querySelect = await this.sql.runSql(sqlSelect, database);
          if (querySelect.recordset.length > 0) {
            // Si existe, actualiza el valor
            let sqlUpdateExtes = `UPDATE dependentesExtes SET valor = '${safeValor}' WHERE id = '${codi}' AND nom = '${safeNom}'`;
            await this.sql.runSql(sqlUpdateExtes, database);
          } else {
            // Si no existe, inserta un nuevo registro
            let sqlInsertExtes = `INSERT INTO dependentesExtes (id, nom, valor) VALUES ('${codi}', '${safeNom}', '${safeValor}')`;
            await this.sql.runSql(sqlInsertExtes, database);
          }
        }
        console.log(`Trabajador actualizado con dni: ${trabajador.documento}`);
      }
      i++;
      console.log(`Trabajador procesado (${i}/${res.data.value.length})\n--------------------`);
    }
    return true;
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
  sanitizeFecha(fecha: string): string {
    if (!fecha) return null;
    try {
      const year = parseInt(fecha.split("-")[0]);
      if (year < 1900) return null; // o una fecha por defecto
      return fecha;
    } catch {
      return null;
    }
  }
}
