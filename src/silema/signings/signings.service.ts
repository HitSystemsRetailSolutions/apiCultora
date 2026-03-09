import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { response } from 'express';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';

@Injectable()
export class signingsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncSignings(companyNAME: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let signings;
    try {
      signings = await this.sql.runSql(
        `select convert(nvarchar, tmst, 121) tmstStr, idr, tmst, accio, usuari, (select nom from dependentes where codi = usuari) as nombre, isnull((SELECT valor FROM dependentesExtes WHERE id = usuari AND nom = 'DNI'), '') as dni, isnull(editor, '') editor, isnull(left(historial, 100), '') historial, isnull(lloc, '') lloc, isnull(left(comentari, 50), '') comentari, id from cdpDadesFichador where tmst>=(select timestamp from records where concepte='BC_CdpDadesFichador') and comentari not like '%365EquipoDeTrabajo%' and year(tmst)<=year(getdate()) and tmst<= GETDATE() order by tmst`,
        database,
      );
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }
    if (signings.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn('⚠️ Advertencia: No se encontraron registros de fichajes en la base de datos');
      return false;
    }
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const signing of signings.recordset) {
      let timestamp = moment.utc(signing.tmst).tz("Europe/Madrid", true).format("YYYY-MM-DDTHH:mm:ss.SSSZ");
      try {
        const data = {
          idr: signing.idr,
          tmst: timestamp,
          accio: signing.accio,
          usuari: signing.usuari,
          nombre: signing.nombre,
          dni: signing.dni,
          editor: signing.editor,
          historial: signing.historial,
          lloc: signing.lloc,
          comentari: signing.comentari,
          id: signing.id,
        };
        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/cdpDadesFichador2?$filter=idr eq '${signing.idr}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          this.logError(`❌ Error consultando el fichaje en BC`, error);
          continue;
        }

        if (res.data.value.length === 0) {
          await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/cdpDadesFichador2`, data, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        }
        await this.sql.runSql(`UPDATE records SET timestamp='${signing.tmstStr}' WHERE Concepte='BC_CdpDadesFichador'`, database);
      } catch (error) {
        this.logError(`❌ Error al insertar el fichaje`, error);
        continue;
      }
      console.log(`⏳ Sincronizando fichajes... -> ${i}/${signings.recordset.length} --- ${((i / signings.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    return true;
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
