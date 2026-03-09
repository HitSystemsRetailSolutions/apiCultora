import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { helpersService } from 'src/helpers/helpers.service';
import { checksService } from './checks.service';
@Injectable()
export class salesSilemaAbonoService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private helpers: helpersService,
    private checks: checksService,
  ) { }

  //Abono
  async syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (botiga === '225' || botiga === '842') {
      // Esta licencia es de cocina no se tiene que pasar a BC
      return true;
    }
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaAbono';

    const locationCode = await this.checks.validateStore(botiga, day, month, year, turno, companyID, entorno, database, 'Abonos');
    if (!locationCode) return false;

    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'INIT', `Iniciando sincronización de abonos (Almacén: ${locationCode})`, 'Abonos', companyID, entorno);
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
      this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'NO_TURNOS', `No se encontraron turnos para la tienda ${botiga} en la fecha ${day}-${month}-${year}`, 'Abonos', companyID, entorno);
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
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'INVALID_TURNO', `El turno ${turno} no existe. Turnos disponibles: ${turnos.length}`, 'Abonos', companyID, entorno);
      return true;
    } else {
      // Por defecto, enviar todos
      turnosAEnviar = turnos;
    }
    await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'TURNOS', `Turnos a procesar: ${JSON.stringify(turnosAEnviar)}`, 'Abonos', companyID, entorno);
    for (let i = 0; i < turnosAEnviar.length; i++) {
      const { horaInicio, horaFin } = turnosAEnviar[i];
      const formattedHoraInicio = horaInicio.toISOString().substr(11, 8); // Formato HH:mm:ss
      const formattedHoraFin = horaFin.toISOString().substr(11, 8);
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'PROCESS_TURNO', `Procesando turno ${i + (Number(turno) === 2 ? 2 : 1)}: ${formattedHoraInicio} - ${formattedHoraFin}`, 'Abonos', companyID, entorno);
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
        await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'SKIP_TURNO', `Turno ${i + (Number(turno) === 2 ? 2 : 1)} omitido por cierre Z con importe 0 o inexistente`, 'Abonos', companyID, entorno);
        continue;
      }

      await this.processTurnoSalesSilemaAbono(i + (Number(turno) === 2 ? 2 : 1), botiga, day, month, year, formattedHoraInicio, formattedHoraFin, database, tipo, tenant, entorno, companyID, token);
    }
    return true;
  }

  private getSQLQuerySalesSilemaAbono(botiga: number, day: number, month: number, year: number, horaInicio: string, horaFin: string) {
    return `
      DECLARE @Botiga INT = ${botiga};
      DECLARE @Dia INT = ${day};
      DECLARE @HoraInicio TIME = '${horaInicio}';
      DECLARE @HoraFin TIME = '${horaFin}';

      ;WITH ExtractedData AS (
        SELECT
            SUBSTRING(v.otros,CHARINDEX('id:', v.otros) + 3,CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - CHARINDEX('id:', v.otros) - 3) AS ExtractedValue,
            v.num_tick AS NumeroTicket,
            v.plu AS PLU,
            a.nom AS Article, 
            v.quantitat AS Quantitat,
            v.import / NULLIF(V.Quantitat, 0) AS PreuUnitari,
            i.iva AS IVA,
            v.Botiga,
            CAST(v.data AS DATE) AS Data
        FROM [v_venut_${year}-${month}] v
        LEFT JOIN articles a ON v.plu = a.codi
        LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
        WHERE num_tick IN (
                SELECT SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu))
                FROM [v_moviments_${year}-${month}]
                WHERE botiga = @Botiga
                  AND DAY(data) = @Dia
                  AND CONVERT(TIME,Data) BETWEEN @HoraInicio AND @HoraFin
                  AND motiu LIKE 'Deute client%'
                )
          AND CHARINDEX('id:', v.otros) > 0
          AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
          AND CONVERT(TIME, Data) BETWEEN @HoraInicio AND @HoraFin
          AND LEN(SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3,CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - CHARINDEX('id:', v.otros) - 3)) > 0
          AND  v.botiga = @Botiga
      ),

      FilteredData AS (
          SELECT
              d.ExtractedValue,
              c.valor,
              c.codi AS CodigoCliente,
              cl.nif AS NIF,
              cl.Nom AS NomClient,
              d.PreuUnitari,
              d.Quantitat,
              d.IVA,
              d.NumeroTicket,
              d.PLU,
              d.Article,
              cl2.Nif AS NifTienda,
              cl2.Nom AS Nom,
              d.Data
          FROM ExtractedData d
          INNER JOIN constantsclient c ON c.valor = d.ExtractedValue AND c.variable = 'CFINAL'
          INNER JOIN clients cl ON cl.codi = c.codi
          INNER JOIN clients cl2 ON cl2.codi = d.Botiga
      ),

      Totals AS (
          SELECT
              NIF,
              SUM(Quantitat * PreuUnitari) AS TotalAmbIVA,
              SUM(Quantitat * PreuUnitari / (1 + IVA / 100.0)) AS TotalSenseIVA
          FROM FilteredData
          GROUP BY NIF
      ),
	    TotalsAbono AS (
          SELECT
              SUM(Quantitat * PreuUnitari) AS TotalAmbIVA,
              SUM(Quantitat * PreuUnitari / (1 + IVA / 100.0)) AS TotalSenseIVA
          FROM FilteredData
      )

      SELECT
          fd.Data,
          fd.Nom AS Nom,
          LTRIM(RTRIM(fd.NomClient)) AS NomClient,
          LTRIM(RTRIM(fd.NifTienda)) AS NifTienda,
          LTRIM(RTRIM(fd.NIF)) AS NIF,
          fd.CodigoCliente,
          fd.NumeroTicket,
          fd.PLU,
          fd.Article,
          fd.Quantitat,
          fd.IVA,
          ROUND(fd.PreuUnitari, 5) AS PreuUnitari,
          ROUND(fd.PreuUnitari / (1 + fd.IVA / 100.0), 5) AS PreuUnitariSenseIVA,
          fd.Quantitat * fd.PreuUnitari AS TotalLinia,
          ROUND(fd.Quantitat * fd.PreuUnitari/ (1 + fd.IVA / 100.0),5) AS TotalLiniaSenseIVA,
          ROUND(t.TotalAmbIVA, 5) AS TotalAmbIVA,
          ROUND(t.TotalSenseIVA, 5) AS TotalSenseIVA,
          ROUND(t.TotalAmbIVA - t.TotalSenseIVA, 5) AS TotalIVA,
          ROUND(at.TotalAmbIVA, 5) AS ATotalAmbIVA,
          ROUND(at.TotalSenseIVA, 5) AS ATotalSenseIVA,
          ROUND(at.TotalAmbIVA - at.TotalSenseIVA, 5) AS ATotalIVA
      FROM FilteredData fd
      JOIN Totals t ON t.NIF = fd.NIF
      CROSS  JOIN TotalsAbono at
      ORDER BY fd.NIF, fd.NumeroTicket, fd.plu;`;
  }

  async processTurnoSalesSilemaAbono(turno, botiga, day, month, year, horaInicio, horaFin, database, tipo, tenant, entorno, companyID, token) {
    //Abono
    let sqlQ = this.getSQLQuerySalesSilemaAbono(botiga, day, month, year, horaInicio, horaFin);

    let data = await this.sql.runSql(sqlQ, database);
    //console.log("Data lenght: " + data.recordset.length)
    //console.log(sqlQ);
    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let shortYear = year.slice(-2);

      let formattedDay = day.padStart(2, '0');
      let formattedMonth = month.padStart(2, '0');
      // Formateamos la fecha en el formato ddmmyy
      let formattedDate = `${formattedDay}-${formattedMonth}-${shortYear}`;
      let formattedDate2 = new Date(x.Data).toISOString().substring(0, 10);
      let sellToCustomerNo = '';
      if (x.NifTienda == 'B61957189') {
        sellToCustomerNo = '430001314';
      }
      x.Nom = x.Nom.substring(0, 6);
      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
        documentType: 'Credit_x0020_Memo', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${this.checks.extractNumber(x.Nom)}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: parseFloat(x.ATotalAmbIVA.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.ATotalSenseIVA.toFixed(2)), // Precio total sin IVA por factura
        vatAmount: parseFloat(x.ATotalIVA.toFixed(2)), // IVA total por factura,
        sellToCustomerNo: `${sellToCustomerNo}`, // COSO
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${this.checks.extractNumber(x.Nom).toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NifTienda}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };

      if (salesData.locationCode === 'null' || !salesData.locationCode) {
        await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'NULL_LOCATION', `Se ha detectado un locationCode nulo para el documento ${salesData.no}. Abortando proceso.`, 'Abonos', companyID, entorno);
        console.error(`locationCode nulo para documento ${salesData.no}`);
        return false;
      }

      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'info', 'CREATE_CREDIT_MEMO', `Procesando venta ${salesData.no} - Total: ${salesData.remainingAmount} - Lineas: ${data.recordset.length}`, 'Abonos', companyID, entorno);
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
        let isoDate = new Date(x.Data).toISOString().substring(0, 10);
        if (x.IVA === 'IVA00') x.IVA = 'IVA0';
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `Item`,
          no: `${x.PLU}`,
          lineNo: i + 1,
          description: `${x.Article}`,
          quantity: parseFloat(x.Quantitat),
          shipmentDate: isoDate,
          lineTotalAmount: parseFloat(x.TotalLinia),
          lineAmountExclVat: parseFloat(x.TotalLiniaSenseIVA),
          vatProdPostingGroup: `${x.IVA}`,
          unitPrice: parseFloat(x.PreuUnitari),
          unitPriceExclVat: parseFloat(x.PreuUnitariSenseIVA),
          locationCode: `${this.checks.extractNumber(x.Nom)}`,
        };

        salesData.salesLinesBuffer.push(salesLine);
      }

      // console.log('ABONO:', salesData);
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

      //---------------------------------------------------Pedidos------------------------------------------------------//
      x = data.recordset[0];
      sellToCustomerNo = '';
      x.Nom = x.Nom.substring(0, 6);
      let nCliente = 1;
      let cliente = `C${nCliente}`;
      salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº factura
        documentType: 'Order', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº documento externo
        locationCode: `${this.checks.extractNumber(x.Nom)}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: parseFloat(x.TotalAmbIVA.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.TotalSenseIVA.toFixed(2)), // Precio total sin IVA por factura
        vatAmount: parseFloat(x.TotalIVA.toFixed(2)), // IVA total por factura
        sellToCustomerNo: `${sellToCustomerNo}`, // COSO
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${this.checks.extractNumber(x.Nom).toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NIF}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };

      let NifAnterior = x.NIF;
      let lastAlbaranDescription = '';
      let lineCounter = 1;
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        if (x.NIF != NifAnterior) {
          // console.log('NIF DIFERENTE\nSubiendo factura');
          // console.log(`salesData Number: ${salesData.no}`);
          // console.log(salesData);
          await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
          //Si el NifActual es diferente al Nif anterior tengo que primero. subo la factura actual, segundo. vacio el array de mi diccionario y cambio el "vatRegistrationNo" por el nuevo nif. Y repetir el proceso

          salesData.salesLinesBuffer = [];
          salesData.vatRegistrationNo = x.NIF;
          //salesData.sellToCustomerNo = `43000${String(x.CodigoCliente)}`;
          nCliente++;
          cliente = `C${nCliente}`;
          salesData.no = `${x.Nom}_${turno}_${formattedDate}_${cliente}`;
          salesData.externalDocumentNo = `${x.Nom}_${turno}_${formattedDate}_${cliente}`;
          salesData.remainingAmount = parseFloat(x.TotalAmbIVA.toFixed(2));
          salesData.amountExclVat = parseFloat(x.TotalSenseIVA.toFixed(2));
          salesData.vatAmount = parseFloat(x.TotalIVA.toFixed(2));
        }
        let date = new Date(x.Data);
        let isoDate = date.toISOString().substring(0, 10);
        let partesAlbaran = isoDate.split('-');
        let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
        let currentAlbaranDescription = `albaran nº ${x.NumeroTicket} ${formattedDateAlbaran}`;
        if (currentAlbaranDescription !== lastAlbaranDescription) {
          let salesLineAlbaran = {
            documentNo: `${salesData.no}`,
            lineNo: lineCounter,
            description: currentAlbaranDescription,
            quantity: 1,
            shipmentDate: `${isoDate}`,
            lineTotalAmount: 0,
            locationCode: `${this.checks.extractNumber(x.Nom)}`,
          };
          lineCounter++;
          salesData.salesLinesBuffer.push(salesLineAlbaran);
          lastAlbaranDescription = currentAlbaranDescription;
        }
        x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.IVA === 'IVA00') x.IVA = 'IVA0';
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `Item`,
          no: `${x.PLU}`,
          lineNo: lineCounter,
          description: `${x.Article}`,
          quantity: parseFloat(x.Quantitat),
          shipmentDate: isoDate,
          lineTotalAmount: parseFloat(x.TotalLinia),
          lineAmountExclVat: parseFloat(x.TotalLiniaSenseIVA),
          vatProdPostingGroup: `${x.IVA}`,
          unitPrice: parseFloat(x.PreuUnitari),
          unitPriceExclVat: parseFloat(x.PreuUnitariSenseIVA),
          locationCode: `${this.checks.extractNumber(x.Nom)}`,
        };
        salesData.salesLinesBuffer.push(salesLine);
        lineCounter++;
        NifAnterior = x.NIF;
      }
      // console.log(JSON.stringify(salesData, null, 2));
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    } else {
      await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'warning', 'NO_DATA', `No hay datos para el turno ${turno} (${horaInicio} - ${horaFin})`, 'Abonos', companyID, entorno);
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
        await this.helpers.addLog(salesData.locationCode, salesData.postingDate, salesData.shift.replace('Shift_x0020_', ''), 'info', 'POST_OK', `${tipo} ${salesData.no} subido con exito`, 'Abonos', companyID, entorno);

      } catch (error) {
        salesData.salesLinesBuffer = [];
        console.log(JSON.stringify(salesData, null, 2));
        await this.helpers.addLog(salesData.locationCode, salesData.postingDate, salesData.shift.replace('Shift_x0020_', ''), 'error', 'POST_ERROR', `Error al subir ${tipo} ${salesData.no}: ${typeof error.response?.data === 'object'
          ? JSON.stringify(error.response.data)
          : error.response?.data || error.message}`, 'Abonos', companyID, entorno);
        console.error(`Error posting sales ${tipo} data:`, error.response?.data || error.message);
        return;
      }
    } else {
      console.log(`Ya existe la ${tipo}: ${salesData.no}`);
    }
  }
}
