import { Injectable } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';
import * as mqtt from 'mqtt';

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
    if (factura == 'filapena') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif ='B66567470' and empnif = 'B64990906' and day(DataEmissio)=${day}`
    } else if (factura == 'ime_mil') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif ='B61957189' and empnif = 'B64990906' and day(DataEmissio)=${day}`
    } else if (factura == 'franquicias') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where clientnif not in ('B66567470','B61957189','B64990906') and ClientCodi in (select codi from ParamsHw) and empnif = 'B64990906' and day(DataEmissio)=${day}`
    } else if (factura == 'todas') {
      query = `select IdFactura from [facturacio_${tabla}_iva] where empnif = 'B64990906' and ClientCodi in (select codi from ParamsHw) and day(DataEmissio)=${day}`
    } else {
      console.log(`No se ha seleccionado ninguna factura válida.`);
      return false;
    }
    const idFacturas = await this.sql.runSql(query, 'fac_tena');
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
}
