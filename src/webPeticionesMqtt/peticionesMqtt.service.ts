import { Injectable } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';
import * as mqtt from 'mqtt';
import * as sql from 'mssql';

@Injectable()
export class peticionesMqttService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private sql: runSqlService,
  ) { }

  async syncIntercompanyByDate(companyID: string, entorno: string, day: string, month: string, anio: string, factura: string) {
    let query = '';
    const tabla = `${anio}-${month}`;
    let inputs = [{ name: 'day', type: sql.Int, value: Number(day) }];

    if (factura == 'filapena') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif ='B66567470' and empnif = 'B64990906' and day(DataEmissio)=@day`
    } else if (factura == 'ime_mil') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif ='B61957189' and empnif = 'B64990906' and day(DataEmissio)=@day`
    } else if (factura == 'franquicias') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif not in ('B66567470','B61957189','B64990906') and ClientCodi in (select codi from ParamsHw) and empnif = 'B64990906' and day(DataEmissio)=@day`
    } else if (factura == 'todas') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where empnif = 'B64990906' and ClientCodi in (select codi from ParamsHw) and day(DataEmissio)=@day`
    } else {
      console.log(`No se ha seleccionado ninguna factura válida.`);
      return false;
    }
    const idFacturas = await this.sql.runSql(query, 'fac_tena', inputs);
    console.log(`Facturas encontradas: ${idFacturas.recordset.length}`);
    if (idFacturas.recordset.length === 0) {
      console.log(`No se encontraron facturas para el día ${day} del mes ${month}.`);
      return false;
    }
    const message = {
      msg: "silemaIntercompany",
      idFactura: [
        ...idFacturas.recordset.map((item) => item.IdFactura),
      ],
      tabla: `${tabla}`,
      database: "fac_tena",
      tenant: process.env.tenaTenant,
      companyID: companyID,
      entorno: entorno,
      client_id: process.env.tenaClientId,
      client_secret: process.env.tenaClientSecret
    }
    console.log(`Enviando mensaje MQTT: ${JSON.stringify(message)}`);
    this.client.publish('/Hit/Serveis/Apicultor', JSON.stringify(message), { qos: 1 });
    return true;

  }
  async syncSilemaDate(diaInicio: string, diaFin: string, mes: string, anio: string, turno: number, companyID: string, entorno: string, empresa: string, tiendas: string = "") {

    let tiendasArray: any[] = [];
    if (tiendas && tiendas !== '') {
      tiendasArray = tiendas.split(',').map(t => t.trim()).filter(t => t !== '');
    } else if (empresa == 'imeMil') {
      const query = `select codi from clients where codi in (select codi from ParamsHw) and nif = 'B61957189' and nom not like 'no%' order by codi`
      const listaTiendas = await this.sql.runSql(query, 'fac_tena');
      tiendasArray = listaTiendas.recordset.map((item) => item.codi);
    } else if (empresa == 'filapena') {
      const query = `select codi from clients where codi in (select codi from ParamsHw) and nif = 'B66567470' and nom not like 'no%' order by codi`
      const listaTiendas = await this.sql.runSql(query, 'fac_tena');
      tiendasArray = listaTiendas.recordset.map((item) => item.codi);
    }

    console.log(tiendasArray);

    const message = {
      msg: "silemaDateTurno",
      turno: Number(turno),
      botiga: tiendasArray,
      dayStart: diaInicio,
      dayEnd: diaFin,
      month: mes,
      year: anio,
      database: "fac_tena",
      tenant: process.env.tenaTenant,
      companyID: companyID,
      entorno: entorno,
      client_id: process.env.tenaClientId,
      client_secret: process.env.tenaClientSecret
    }
    console.log(`Enviando mensaje MQTT cierre: ${JSON.stringify(message)}`);
    this.client.publish('/Hit/Serveis/Apicultor', JSON.stringify(message), { qos: 1 });
    return true;

  }

  async cronIntercompanySync(params: any) {
    const { companyID, database, entorno, client_id, client_secret, tenant } = params;
    const dayjs = require('dayjs');

    // 1. Calcular rango de fechas (Lunes anterior 10:00 a este Lunes 10:00)
    // Usamos .day(1) para asegurar que sea Lunes independientemente del locale del servidor
    let endMonday = dayjs().day(1).hour(10).minute(0).second(0); // Lunes de esta semana 10:00
    if (dayjs().isBefore(endMonday)) {
      endMonday = endMonday.subtract(1, 'week');
    }
    const startMonday = endMonday.subtract(1, 'week');

    console.log(`Buscando facturas Intercompany entre ${startMonday.format()} y ${endMonday.format()}`);

    // 2. Determinar qué tablas de meses mirar (puede haber cambio de mes en el rango de 7 días)
    const monthsToCheck = new Set<string>();
    monthsToCheck.add(startMonday.format('YYYY-MM'));
    monthsToCheck.add(endMonday.format('YYYY-MM'));

    for (const month of monthsToCheck) {
      const tablaFactu = `[facturacio_${month}_iva]`;

      const queryInsert = `
        INSERT INTO RecordsFacturacioBC (DataEmissio, Emissor, TipusFactura, IdFactura, EstatTraspas, TimeStamp)
        SELECT DataEmissio, EmpresaCodi, 'Intercompany', IdFactura, 0, GETDATE()
        FROM ${tablaFactu}
        WHERE EmpresaCodi = 9 
          AND DataEmissio >= @start 
          AND DataEmissio < @end
          AND IdFactura NOT IN (SELECT IdFactura FROM RecordsFacturacioBC)
      `;

      const inputs = [
        { name: 'start', type: sql.DateTime, value: startMonday.toDate() },
        { name: 'end', type: sql.DateTime, value: endMonday.toDate() }
      ];

      await this.sql.runSql(queryInsert, database, inputs);
    }

    // 3. Consultar TODAS las pendientes de tipo Intercompany
    const queryPendientes = `
      SELECT IdFactura, DataEmissio 
      FROM RecordsFacturacioBC 
      WHERE TipusFactura = 'Intercompany' AND EstatTraspas = 0
    `;
    const pendientes = await this.sql.runSql(queryPendientes, database);

    if (pendientes.recordset.length === 0) {
      console.log('No hay facturas Intercompany pendientes de sincronizar.');
      return true;
    }

    // 4. Agrupar por mes (tabla) para llamar a la sincronización existente
    const groups: { [key: string]: string[] } = {};
    for (const row of pendientes.recordset) {
      const monthStr = dayjs(row.DataEmissio).format('YYYY-MM');
      if (!groups[monthStr]) groups[monthStr] = [];
      groups[monthStr].push(row.IdFactura);
    }

    // 5. Lanzar mensajes de sincronización por cada grupo
    for (const month in groups) {
      const syncMsg = {
        msg: "silemaIntercompany",
        idFactura: groups[month],
        tabla: month,
        database: database,
        tenant: tenant || process.env.tenaTenant,
        companyID: companyID,
        entorno: entorno,
        client_id: client_id || process.env.tenaClientId,
        client_secret: client_secret || process.env.tenaClientSecret
      };

      console.log(`Disparando sincronización Intercompany para el mes ${month} (${groups[month].length} facturas)`);
      this.client.publish('/Hit/Serveis/Apicultor', JSON.stringify(syncMsg), { qos: 1 });
    }

    return true;
  }
}
