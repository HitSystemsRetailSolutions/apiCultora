import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { salesSilemaCierreService } from './salesSilemaCierre.service';
import { salesSilemaAbonoService } from './salesSilemaAbono.service';
import axios from 'axios';
import { helpersService } from 'src/helpers/helpers.service';
import { checksService } from './checks.service';

@Injectable()
export class salesSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private salesSilemaCierre: salesSilemaCierreService,
    private salesSilemaAbono: salesSilemaAbonoService,
    private helpers: helpersService,
    private checks: checksService,
  ) { }

  // Funcion que pasandole un dia de inicio y otro de fin sincroniza los datos de ventas de silema
  async syncSalesSilemaDateTurno(dayStart, dayEnd, month, year, companyID, database, botigas: Array<String>, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      await this.helpers.cleanOldLogs();
      const cutoffDate = new Date(2026, 0, 1); // 01/01/2026

      for (const botiga of botigas) {
        for (let day = dayStart; day <= dayEnd; day++) {
          const currentDate = new Date(year, month - 1, day); // Mes 0-indexado
          const formattedDay = String(day).padStart(2, '0');
          const formattedMonth = String(month).padStart(2, '0');
          const formattedYear = String(year);

          if (currentDate < cutoffDate) {
            console.log(`La fecha ${formattedDay}/${formattedMonth}/${formattedYear} es anterior al 01/01/2026, solo se eliminará el registro de control.`);
            await this.deleteControlTableEntry(formattedDay, formattedMonth, formattedYear, botiga, database, turno);
            continue; // Salta a la siguiente iteración sin sincronizar
          }
          console.log(`Procesando ventas para el día: ${formattedDay}/${formattedMonth}/${formattedYear} | Tienda: ${botiga} | Turno: ${turno}`);

          let success = true;
          let errorWhere = '';

          try {
            errorWhere = 'syncSalesSilema';
            const okSales = await this.syncSalesSilema(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
            if (!okSales) {
              console.log("Ventas NO validadas → NO se harán abonos ni cierres.");
              continue;
            }
          } catch (error) {
            console.error(`Error en ${errorWhere} para el día ${day}/${month}/${year}, tienda ${botiga}:`, error);
            success = false;
          }

          try {
            errorWhere = 'syncSalesSilemaAbono';
            await this.salesSilemaAbono.syncSalesSilemaAbono(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
          } catch (error) {
            console.error(`Error en ${errorWhere} para el día ${day}/${month}/${year}, tienda ${botiga}:`, error);
            success = false;
          }

          try {
            errorWhere = 'syncSalesSilemaCierre';
            await this.salesSilemaCierre.syncSalesSilemaCierre(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
          } catch (error) {
            console.error(`Error en ${errorWhere} para el día ${day}/${month}/${year}, tienda ${botiga}:`, error);
            success = false;
          }

          if (success) {
            try {
              console.log('Ejecutando DELETE en tabla de control...');
              await this.deleteControlTableEntry(formattedDay, formattedMonth, formattedYear, botiga, database, turno);
              console.log('DELETE ejecutado correctamente.');
            } catch (deleteError) {
              console.error('Error al ejecutar el DELETE:', deleteError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error general en syncSalesSilemaDateTurno:', error);
    }
    return true;
  }

  //Sincroniza tickets HIT-BC, Ventas
  async syncSalesSilema(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (botiga === '225' || botiga === '842') {
      // Esta licencia es de cocina no se tiene que pasar a BC
      return true;
    }
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilema';

    const locationCode = await this.checks.validateStore(botiga, day, month, year, turno, companyID, entorno, database, 'Ventas');
    if (!locationCode) return false;

    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'INIT', `Iniciando sincronización de ventas (Almacén: ${locationCode})`, 'Ventas', companyID, entorno);
    let sqlTurnos = `
    SELECT CONVERT(Time, Data) as hora, Tipus_moviment 
    FROM [V_Moviments_${year}-${month}] 
    WHERE botiga = ${botiga} AND Tipus_moviment IN ('Wi', 'W') AND DAY(Data) = ${day} 
    GROUP BY Data, Tipus_moviment 
    ORDER BY Data
    `;
    let queryTurnos = await this.sql.runSql(sqlTurnos, database);
    let records = queryTurnos.recordset;
    if (records.length === 0) {
      this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'NO_TURNOS', `No se encontraron turnos para la tienda ${botiga} en la fecha ${day}-${month}-${year}`, 'Ventas', companyID, entorno);
      console.log(`No se encontraron turnos para la tienda ${botiga} en la fecha ${day}-${month}-${year}`);
      return;
    }

    let turnos: { horaInicio: Date; horaFin: Date }[] = [];
    let currentTurn: { horaInicio?: Date } = {};

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const horaDate = new Date(row.hora);

      if (row.Tipus_moviment === 'Wi') {
        currentTurn = { horaInicio: horaDate };
      } else if (row.Tipus_moviment === 'W' && currentTurn.horaInicio) {
        turnos.push({ horaInicio: currentTurn.horaInicio, horaFin: horaDate });
        currentTurn = {};
      }
    }
    let turnosAEnviar = [];
    if (Number(turno) === 1 && turnos.length >= 1) {
      // Solo el primer turno
      turnosAEnviar = [turnos[0]];
    } else if (Number(turno) === 2 && turnos.length > 1) {
      // El resto de turnos (2 en adelante)
      turnosAEnviar = turnos.slice(1);
    } else if (Number(turno) > turnos.length) {
      turnosAEnviar = [];
      console.log(`El turno ${turno} no existe para la tienda ${botiga} en la fecha ${day}-${month}-${year}. Turnos disponibles: ${turnos.length}`);
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'INVALID_TURNO', `El turno ${turno} no existe. Turnos disponibles: ${turnos.length}`, 'Ventas', companyID, entorno);
      return true;
    } else {
      // Por defecto, enviar todos
      turnosAEnviar = turnos;
    }
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'TURNOS', `Turnos a procesar: ${JSON.stringify(turnosAEnviar)}`, 'Ventas', companyID, entorno);
    for (let i = 0; i < turnosAEnviar.length; i++) {
      const { horaInicio, horaFin } = turnosAEnviar[i];
      const formattedHoraInicio = horaInicio.toISOString().substr(11, 8); // Formato HH:mm:ss
      const formattedHoraFin = horaFin.toISOString().substr(11, 8);
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'PROCESS_TURNO', `Procesando turno ${i + (Number(turno) === 2 ? 2 : 1)}: ${formattedHoraInicio} - ${formattedHoraFin}`, 'Ventas', companyID, entorno);
      console.log(`Turno ${i + (Number(turno) === 2 ? 2 : 1)}: ${formattedHoraInicio} - ${formattedHoraFin}`);
      const sqlCheckZ = `
      SELECT TOP 1 Import 
      FROM [V_Moviments_${year}-${month}]
      WHERE botiga = ${botiga}
      AND Tipus_moviment = 'Z'
      AND DAY(Data) = ${day}
      AND CONVERT(Time, Data) BETWEEN '${formattedHoraInicio}' AND '${formattedHoraFin}'
      AND Import > 0
     `;
      const resultZ = await this.sql.runSql(sqlCheckZ, database);

      if (resultZ.recordset.length === 0) {
        console.log(`Turno ${i + (Number(turno) === 2 ? 2 : 1)} omitido por cierre Z con importe 0 o inexistente`);
        await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'SKIP_TURNO', `Turno ${i + (Number(turno) === 2 ? 2 : 1)} omitido por cierre Z con importe 0 o inexistente`, 'Ventas', companyID, entorno);
        continue;
      }
      const checkResults = await this.checks.validaCaja(botiga, year, month, day, formattedHoraInicio, formattedHoraFin, database, turno);
      if (!checkResults) {
        await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'VALIDATION_FAIL', `El turno NO pasó las validaciones. Se omite el traspaso.`, 'Ventas', companyID, entorno);
        return false;
      }
      console.log(`Turno ${turno} validado correctamente. Procesando ventas...`);
      await this.processTurnoSalesSilema(i + (Number(turno) === 2 ? 2 : 1), botiga, day, month, year, formattedHoraInicio, formattedHoraFin, database, tipo, tenant, entorno, companyID, token);
    }
    return true;
  }

  private getSQLQuerySalesSilema(botiga: number, day: number, month: number, year: number, horaInicio: string, horaFin: string) {
    return `
    DECLARE @Botiga INT =${botiga};
    DECLARE @Dia INT = ${day};
    DECLARE @HoraInicio TIME = '${horaInicio}';
    DECLARE @HoraFin TIME = '${horaFin}';

    DECLARE @TotalSinIVA DECIMAL(18, 2);

    SELECT @TotalSinIVA = SUM(v.import / (1 + (ISNULL(COALESCE(t.Iva, tz.Iva), 10) / 100.0)))
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = @Botiga AND DAY(v.data) = @Dia AND CONVERT(TIME, v.data) BETWEEN @HoraInicio AND @HoraFin

    SELECT 
        LTRIM(RTRIM(c.Nom)) AS Nom, 
        LTRIM(RTRIM(c.Nif)) AS Nif, 
        MIN(CONVERT(DATE, v.data)) AS Data, 
        LTRIM(RTRIM(COALESCE(a.Codi, az.Codi))) AS Codi, 
        LTRIM(RTRIM(COALESCE(a.NOM, az.NOM))) AS Producte, 
        COALESCE(a.PREU, az.PREU) AS Preu, 
        SUM(import) AS Import, 
        SUM(quantitat) AS Quantitat, 
        COALESCE(t.Iva, tz.Iva) AS Iva, 
        ROUND(v.Import / NULLIF(v.Quantitat, 0), 5) AS precioUnitario, 
        SUM(SUM(import)) OVER () AS Total,
        ROUND(SUM(v.import) / (1 + (ISNULL(COALESCE(t.Iva, tz.Iva), 10) / 100)),5) AS SinIVA,
        @TotalSinIVA AS TotalSinIVA,
        (SELECT MIN(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = @Botiga AND DAY(data) = @Dia AND CONVERT(TIME, data) BETWEEN @HoraInicio AND @HoraFin) AS MinNumTick, 
        (SELECT MAX(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = @Botiga AND DAY(data) = @Dia AND CONVERT(TIME, data) BETWEEN @HoraInicio AND @HoraFin) AS MaxNumTick
    FROM [v_venut_${year}-${month}] v 
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN clients c ON v.botiga = c.codi 
    LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = @Botiga AND DAY(v.data) = @Dia AND CONVERT(TIME, v.data) BETWEEN @HoraInicio AND @HoraFin 
    GROUP BY 
        LTRIM(RTRIM(c.nom)), 
        LTRIM(RTRIM(c.Nif)), 
        LTRIM(RTRIM(COALESCE(a.NOM, az.NOM))), 
        LTRIM(RTRIM(COALESCE(a.Codi, az.Codi))), 
        COALESCE(a.PREU, az.PREU), 
        COALESCE(t.Iva, tz.Iva), 
        ROUND(v.Import / NULLIF(v.Quantitat, 0), 5)
    HAVING SUM(quantitat) > 0;`;
  }

  async processTurnoSalesSilema(turno: number, botiga: number, day: number, month: number, year: number, horaInicio, horaFin, database: string, tipo: string, tenant: string, entorno: string, companyID: string, token: string) {
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'PROCESS_TURNO', `${horaInicio} - ${horaFin}`, 'Ventas', companyID, entorno);
    let sqlQuery = await this.getSQLQuerySalesSilema(botiga, day, month, year, horaInicio, horaFin);
    let data = await this.sql.runSql(sqlQuery, database);

    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let date = new Date(x.Data);

      // Extraemos el día, el mes y el año
      let formattedDay = String(date.getDate()).padStart(2, '0');
      let formattedMonth = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
      let formattedYear = String(date.getFullYear()).slice(2); // Últimos dos dígitos del año
      let formattedDate = `${formattedDay}-${formattedMonth}-${formattedYear}`;
      let formattedDate2 = date.toISOString().substring(0, 10);

      let sellToCustomerNo = x.Nif;
      x.Nom = x.Nom.substring(0, 6);
      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`,
        documentType: 'Invoice',
        dueDate: formattedDate2,
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`,
        locationCode: `${this.checks.extractNumber(x.Nom)}`,
        orderDate: formattedDate2,
        postingDate: formattedDate2,
        recapInvoice: false,
        remainingAmount: parseFloat(x.Total.toFixed(2)),
        amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)),
        shift: `Shift_x0020_${turno}`,
        sellToCustomerNo: sellToCustomerNo,
        shipToCode: `${this.checks.extractNumber(x.Nom).toUpperCase()}`,
        storeInvoice: true,
        vatRegistrationNo: x.Nif,
        firstSummaryDocNo: x.MinNumTick.toString(),
        lastSummaryDocNo: x.MaxNumTick.toString(),
        invoiceStartDate: formattedDate2,
        invoiceEndDate: formattedDate2,
        salesLinesBuffer: [],
      };

      if (salesData.locationCode === 'null' || !salesData.locationCode) {
        await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'NULL_LOCATION', `Se ha detectado un locationCode nulo para el documento ${salesData.no}. Abortando proceso.`, 'Ventas', companyID, entorno);
        console.error(`locationCode nulo para documento ${salesData.no}`);
        return false;
      }

      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'SALES_DATA', `Procesando venta ${salesData.no} - Total: ${salesData.remainingAmount} - Lineas: ${data.recordset.length}`, 'Ventas', companyID, entorno);
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        let isoDate = new Date(x.Data).toISOString().substring(0, 10);
        x.Iva = `IVA${String(x.Iva).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.Iva === 'IVA00') x.Iva = 'IVA0';
        let salesLine = {
          documentNo: salesData.no,
          type: `Item`,
          no: x.Codi,
          lineNo: i + 1,
          description: x.Producte,
          quantity: parseFloat(x.Quantitat),
          shipmentDate: isoDate,
          lineTotalAmount: parseFloat(x.Import),
          vatProdPostingGroup: `${x.Iva}`,
          unitPrice: parseFloat(x.precioUnitario),
          locationCode: `${this.checks.extractNumber(x.Nom)}`,
        };
        salesData.salesLinesBuffer.push(salesLine);
      }
      //salesData.remainingAmount = parseFloat(Number(x.Total).toFixed(2));
      // console.log(JSON.stringify(salesData, null, 2));
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    } else {
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'NO_DATA', `No hay datos para el turno ${turno} (${horaInicio} - ${horaFin})`, 'Ventas', companyID, entorno);
    }
  }

  async postToApi(tipo, salesData, tenant, entorno, companyID, token) {
    if (salesData.no.length > 20) salesData.no = salesData.no.slice(-20);
    if (salesData.locationCode.length > 10) salesData.locationCode = salesData.locationCode.slice(-10);
    if (salesData.shipToCode.length > 10) salesData.shipToCode = salesData.shipToCode.slice(-10);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${salesData.no}') and documentType eq '${salesData.documentType}'`;
    //console.log(url1);
    let resGet1 = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain sale');
      });

    if (!resGet1.data) throw new Error('Failed to get factura line');
    if (resGet1.data.value.length === 0) {
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$expand=salesLinesBuffer`;
      try {
        const response = await axios.post(
          url2,
          salesData, // Envía salesData directamente
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        );
        //console.log('Response:', response.data);
        console.log(`${tipo} subido con exito ${salesData.no}`);
        await this.helpers.addLog(salesData.locationCode, salesData.postingDate, salesData.shift.replace('Shift_x0020_', ''), 'info', 'POST_OK', `${tipo} ${salesData.no} subido con exito`, 'Ventas', companyID, entorno);
      } catch (error) {
        salesData.salesLinesBuffer = [];
        console.log(JSON.stringify(salesData, null, 2));
        console.error(`Error posting sales ${tipo} data:`, error.response?.data || error.message);
        await this.helpers.addLog(salesData.locationCode, salesData.postingDate, salesData.shift.replace('Shift_x0020_', ''), 'error', 'POST_ERROR', `Error al subir ${tipo} ${salesData.no}: ${typeof error.response?.data === 'object'
          ? JSON.stringify(error.response.data)
          : error.response?.data || error.message}`, 'Ventas', companyID, entorno);
        return;
      }
    } else {
      console.log(`Ya existe la ${tipo}: ${salesData.no}`);
    }
  }
  async deleteControlTableEntry(day: string, month: string, year: string, botiga, database, turno?: number) {
    let sqlDelete = `
    DELETE FROM RecordsBC 
    WHERE day(TmStCaixa) = '${day}' AND month(TmStCaixa) = '${month}' AND year(TmStCaixa) = '${year}' AND Botiga = '${botiga}'`;
    if (turno !== undefined) {
      sqlDelete += ` AND Torn = ${turno}`;
    }
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno || 0, 'info', 'DELETE_CONTROL', `Eliminando entrada de control para ${day}-${month}-${year} tienda ${botiga}`, 'Ventas');
    await this.sql.runSql(sqlDelete, database);
  }
}
