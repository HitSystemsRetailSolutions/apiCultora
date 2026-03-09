import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaRecapManualService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async getDatosSalesSilemaRecapitulativaManual(idFactura: string[], tabla: string, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      for (let i = 0; i < idFactura.length; i++) {
        let sqlQ = `SELECT * FROM [FACTURACIO_${tabla}_IVA] WHERE idFactura = '${idFactura[i]}'`;
        let data = await this.sql.runSql(sqlQ, database);

        if (data.recordset.length === 0) {
          console.log(`No se encontraron datos para la factura ID: ${idFactura[i]}`);
          continue;
        }

        let client = data.recordset[0].ClientCodi;
        let dataInici = data.recordset[0].DataInici.toISOString().split('T')[0];
        let dataFi = data.recordset[0].DataFi.toISOString().split('T')[0];
        let dataFactura = data.recordset[0].DataFactura.toISOString().split('T')[0];

        const cutoffDate = new Date(2026, 0, 1); // 01/01/2026
        const facturaDate = new Date(data.recordset[0].DataFactura);

        if (facturaDate < cutoffDate) {
          console.log(`⏭️ Factura ${idFactura[i]} con fecha ${dataFactura} anterior a 01/01/2026. Se elimina control sin sincronizar.`);
          await this.deleteControlTableEntry(database, idFactura[i]);
          continue;
        }

        const tablaYear = tabla.split('-')[0];
        let sqlTickets = `SELECT  NumTick, DataTick, Botiga FROM Tiquets_Recapitulativa_${tablaYear} WHERE IdFactura = '${idFactura[i]}' order by NumTick`;
        let dataTickets = await this.sql.runSql(sqlTickets, database);

        if (dataTickets.recordset.length === 0) {
          console.log(`No se encontraron tickets para la factura ID: ${idFactura[i]}`);
          continue;
        }
        let ticketPairs = [];
        let ticketFechas = [];

        for (let t of dataTickets.recordset) {
          ticketPairs.push({ num_tick: t.NumTick, botiga: t.Botiga });
          ticketFechas.push(t.DataTick.toISOString().split('T')[0]);
        }
        await this.syncSalesSilemaRecapitulativaManual(ticketPairs, ticketFechas, client, dataInici, dataFi, dataFactura, companyID, database, client_id, client_secret, tenant, entorno, idFactura[i]);
      }
    } catch (error) {
      console.error('Error al procesar las facturas recapitulativas manuales:', error);
    }
    return true;
  }

  async syncSalesSilemaRecapitulativaManual(ticketPairs: Array<{ num_tick: number; botiga: number }>, ticketFechas: string[], client, dataInici, dataFi, dataFactura, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string, idFactura: string) {
    try {
      let token = await this.token.getToken2(client_id, client_secret, tenant);
      let tipo = 'syncSalesSilemaRecapitulativaManual';
      // let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
      // let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
      // if (queryFranquicia.recordset.length >= 1) return;
      const ticketFilter = ticketPairs
        .map(p => `(V.num_tick = ${p.num_tick} AND V.botiga = ${p.botiga})`)
        .join(' OR ');
      ticketFechas.sort();

      const fechaMin = ticketFechas[0];
      const fechaMax = ticketFechas[ticketFechas.length - 1];

      let yearInicial = parseInt(fechaMin.substring(0, 4));
      let yearFinal = parseInt(fechaMax.substring(0, 4));

      let monthInicial = parseInt(fechaMin.substring(5, 7));
      let monthFinal = parseInt(fechaMax.substring(5, 7));

      let arrayDatos = [];
      let totalBase = 0;
      let totalCuota = 0;

      for (let year = yearInicial; year <= yearFinal; year++) {
        let startMonth = (year === yearInicial) ? monthInicial : 1;
        let endMonth = (year === yearFinal) ? monthFinal : 12;

        for (let month = startMonth; month <= endMonth; month++) {
          const monthStr = String(month).padStart(2, '0');
          const tablaPeriod = `${year}-${monthStr}`;

          let sqlQ = `
        WITH CTE_TipoFactura AS (
              SELECT valor AS TipoFactura
              FROM configuraFacturaClient
              WHERE nom = 'TIPUSFACTURA'
                AND client = ${parseInt(client, 10)}
        ),
        CTE_Base AS (
          SELECT
              V.data AS Fecha,
			        CB.nom AS TIENDA,
              CB.Nif AS NifTienda,
			        V.num_tick AS TICKET,
              V.botiga,
              V.plu AS PLU,
              A.nom AS ARTICULO,
              V.Quantitat AS Cantidad,
              I.Iva AS IvaPct,
			        ROUND(V.Import / NULLIF(V.Quantitat, 0),5) AS unitPrice,
			        ROUND((V.Import / NULLIF(V.Quantitat, 0)) / (1.0 + I.Iva / 100.0),5) AS unitPriceExcIVA,
              V.Import AS importe,
              ROUND(V.Import / (1.0 + I.Iva / 100.0),5) AS ImportSinIVA,
              CASE 
                WHEN EXISTS (
                    SELECT 1
                    FROM [v_moviments_${tablaPeriod}] M
                    WHERE M.botiga = V.botiga
                      AND M.motiu = 'Deute client: ' + CAST(CAST(V.num_tick AS bigint) AS nvarchar(20))
                ) THEN 0  
                ELSE 1  
              END AS Pagado
          FROM [v_venut_${tablaPeriod}] V
          LEFT JOIN articles A ON A.codi = V.plu
          LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
          LEFT JOIN clients CB ON CB.codi = V.botiga
          WHERE 
              V.Quantitat > 0
              AND (${ticketFilter})
          )
          SELECT *,
            ROUND(ImportSinIVA * IvaPct / 100.0, 5) AS IVA,
            ROUND(SUM(ImportSinIVA) OVER (), 5) AS TotalSinIVA,
            ROUND(SUM(ImportSinIVA * IvaPct / 100.0) OVER (), 5) AS TotalIVA,
            SUM(importe) OVER () AS TOTAL,
            (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) AS TipoFactura
        FROM CTE_Base
        ORDER BY 
        CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) = 'SETMANAL' THEN Articulo END,
        CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) = 'SETMANAL' THEN Fecha END,
        CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) <> 'SETMANAL' THEN Fecha END;`;
          // console.log(sqlQ);
          let data = await this.sql.runSql(sqlQ, database);
          arrayDatos.push(data.recordset);
          if (data.recordset.length > 0) {
            const rawBase = data.recordset[0].TotalSinIVA;
            const rawCuota = data.recordset[0].TotalIVA;

            totalBase += rawBase;
            totalCuota += rawCuota;
            totalBase = Math.round(totalBase * 1000) / 1000;
            totalCuota = Math.round(totalCuota * 1000) / 1000;
          }

          console.log(`${tablaPeriod} - ${data.recordset.length} datos encontrados`);
        }
      }
      totalBase = Math.round(totalBase * 100) / 100;
      totalCuota = Math.round(totalCuota * 100) / 100;
      const totalConIVA = totalBase + totalCuota;

      let datosPlanos = arrayDatos.flat();
      if (datosPlanos.length === 0) {
        throw new Error('No se encontraron facturas en la base de datos.');
      }

      //console.log(datosPlanos.length);

      let x = datosPlanos[0];
      const manual = x.Pagado === 1;
      let partes = dataFactura.split('-');
      let fechaFormateada = `${partes[2]}-${partes[1]}-${partes[0].toString().slice(-2)}`;
      const codis = Array.from(new Set(datosPlanos.map((x) => this.extractNumber(x.TIENDA))));
      const locationCode = codis.length > 1 ? 'REC' : codis[0];
      const locationCodeDocNo = codis.length > 1 ? 'T--REC' : x.TIENDA.substring(0, 6);

      // Obtener NIF del cliente
      const sqlNif = `SELECT NIF FROM Clients WHERE codi = ${parseInt(client, 10)}`;
      const resNif = await this.sql.runSql(sqlNif, database);
      const clientNIF = resNif.recordset.length > 0 ? resNif.recordset[0].NIF : '';

      // Obtener forma de pago de ConstantsClient
      const sqlFormaPago = `SELECT valor AS FORMAPAGO FROM ConstantsClient WHERE Codi = ${parseInt(client, 10)} AND Variable = 'FormaPagoLlista'`;
      const resFormaPago = await this.sql.runSql(sqlFormaPago, database);
      const clientFormaPago = resFormaPago.recordset.length > 0 ? resFormaPago.recordset[0].FORMAPAGO : '';


      // Calculamos `n` basado en las facturas recapitulativas existentes
      let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${locationCodeDocNo}_${fechaFormateada}_${manual ? 'RM' : 'R'}')`;
      const n = (await this.getNumberOfRecap(url, token)) || 1;

      let paymentMethodCode = clientFormaPago === 4 ? 'CLI_TRANSF' : '';
      let salesData

      salesData = {
        no: `${locationCodeDocNo}_${fechaFormateada}_${manual ? 'RM' : 'R'}${n}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${dataFi}`, // Fecha vencimiento
        externalDocumentNo: `${locationCodeDocNo}_${fechaFormateada}_${manual ? 'RM' : 'R'}${n}`, // Nº documento externo
        locationCode: `${locationCode}`, // Cód. almacén
        orderDate: `${dataFi}`, // Fecha pedido
        postingDate: `${dataFactura}`, // Fecha registro
        recapInvoice: manual ? false : true, // Factura recap //false
        manualRecapInvoice: manual ? true : false, // Factura manual
        remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
        vatAmount: parseFloat((x.TOTAL - x.TotalSinIVA).toFixed(2)), // IVA total por factura
        vatRegistrationNo: `${clientNIF}`, // CIF/NIF
        paymentMethodCode: `${paymentMethodCode}`, // Cód. forma de pago
        invoiceStartDate: `${dataInici}`, // Fecha inicio facturación
        invoiceEndDate: `${dataFi}`, // Fecha fin facturación
        documentDate: `${dataInici}`, // Fecha de documento
        shipToCode: '',
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };
      let countLines = 1;
      let lastAlbaranDescription = '';
      for (let i = 0; i < datosPlanos.length; i++) {
        x = datosPlanos[i];
        let date = new Date(x.Fecha);
        let isoDate = date.toISOString().substring(0, 10);
        let partesAlbaran = isoDate.split('-');
        let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
        let currentAlbaranDescription = `albaran nº ${x.TICKET} ${formattedDateAlbaran}`;
        if (x.TipoFactura !== 'SETMANAL') {
          if (currentAlbaranDescription !== lastAlbaranDescription) {
            let salesLineAlbaran = {
              documentNo: `${salesData.no}`,
              lineNo: countLines,
              description: currentAlbaranDescription,
              quantity: 1,
              shipmentDate: `${isoDate}`,
              lineTotalAmount: 0,
              locationCode: `${this.extractNumber(x.TIENDA)}`,
            };
            countLines++;
            salesData.salesLinesBuffer.push(salesLineAlbaran);
            lastAlbaranDescription = currentAlbaranDescription;
          }
        }
        x.IvaPct = `IVA${String(x.IvaPct).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.IvaPct === 'IVA00') x.IvaPct = 'IVA0';
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `Item`,
          no: `${x.PLU}`,
          lineNo: countLines,
          description: `${x.ARTICULO}`,
          quantity: parseFloat(x.Cantidad),
          shipmentDate: `${isoDate}`,
          lineTotalAmount: parseFloat(x.importe),
          lineAmountExclVat: parseFloat(x.ImportSinIVA),
          vatProdPostingGroup: `${x.IvaPct}`,
          unitPrice: parseFloat(x.unitPrice),
          unitPriceExclVat: parseFloat(x.unitPriceExcIVA),
          locationCode: `${this.extractNumber(x.TIENDA)}`,
        };
        countLines++;
        salesData.salesLinesBuffer.push(salesLine);
      }
      // console.log('factura:', salesData);
      if (!manual) {
        await this.postToApi(tipo, salesData, tenant, entorno, companyID, token, database, idFactura);
        return true;
      } else {
        await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
      }

      // ---------------------------------Abono recap manual---------------------------------
      salesData.no = `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`;
      salesData.documentType = 'Credit_x0020_Memo';
      salesData.externalDocumentNo = `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`;
      salesData.vatRegistrationNo = `${x.NifTienda}`;
      salesData.shipToCode = locationCode === 'REC' ? '' : `${locationCode}`;
      salesData.salesLinesBuffer = [];

      countLines = 1;
      lastAlbaranDescription = '';

      for (let i = 0; i < datosPlanos.length; i++) {
        x = datosPlanos[i];
        let date = new Date(x.Fecha);
        let isoDate = date.toISOString().substring(0, 10);
        let partesAlbaran = isoDate.split('-');
        let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
        let currentAlbaranDescription = `albaran nº ${x.TICKET} ${formattedDateAlbaran}`;

        if (currentAlbaranDescription !== lastAlbaranDescription) {
          let salesLineAlbaran = {
            documentNo: `${salesData.no}`,
            lineNo: countLines,
            description: currentAlbaranDescription,
            quantity: 1,
            shipmentDate: `${isoDate}`,
            lineTotalAmount: 0,
            locationCode: `${this.extractNumber(x.TIENDA)}`,
          };
          countLines++;
          salesData.salesLinesBuffer.push(salesLineAlbaran);
          lastAlbaranDescription = currentAlbaranDescription;
        }

        x.IvaPct = `IVA${String(x.IvaPct).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.IvaPct === 'IVA00') x.IvaPct = 'IVA0';

        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `Item`,
          no: `${x.PLU}`,
          lineNo: countLines,
          description: `${x.ARTICULO}`,
          quantity: parseFloat(x.Cantidad),
          shipmentDate: `${isoDate}`,
          lineTotalAmount: parseFloat(x.importe),
          lineAmountExclVat: parseFloat(x.ImportSinIVA),
          vatProdPostingGroup: `${x.IvaPct}`,
          unitPrice: parseFloat(x.unitPrice),
          unitPriceExclVat: parseFloat(x.unitPriceExcIVA),
          locationCode: `${this.extractNumber(x.TIENDA)}`,
        };
        countLines++;
        salesData.salesLinesBuffer.push(salesLine);
      }
      // console.log('abono', salesData);
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token, database, idFactura);

      return true;
    } catch (error) {
      console.error(`Error al sincronizar la factura recapitulativa manual:`, error);
      return false;
    }
  }
  async getNumberOfRecap(url: string, token: string) {
    try {
      // Obtenemos las facturas filtradas desde Business Central
      let resGet = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      // Determinamos `n` basado en el total de facturas recapitulativas encontradas
      return resGet.data.value.length + 1;
      //console.log(`Número de facturas recapitulativas existentes: ${resGet.data.value.length}. Usando número: ${n}`);
    } catch (error) {
      console.error(`Error al obtener las facturas recapitulativas:`, error);
      // Dejamos `n = 1` como valor por defecto
    }
  }

  async postToApi(tipo, salesData, tenant, entorno, companyID, token, database?: string, idFactura?: string) {
    if (salesData.no.length > 20) salesData.no = salesData.no.slice(-20);
    if (salesData.locationCode.length > 10) salesData.locationCode = salesData.locationCode.slice(-10);
    if (salesData.shipToCode.length > 10) salesData.shipToCode = salesData.shipToCode.slice(-10);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=documentType eq '${salesData.documentType}' and 
    vatRegistrationNo eq '${salesData.vatRegistrationNo}' and amountExclVat eq ${salesData.amountExclVat} and postingDate eq ${salesData.postingDate} and locationCode eq '${salesData.locationCode}'`;

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

        if (database && idFactura) {
          await this.deleteControlTableEntry(database, idFactura);
          console.log(`🗑️ Registro eliminado de recordsFacturacioBC para la factura ${idFactura}`);
        }
      } catch (error) {
        salesData.salesLinesBuffer = [];
        console.log(JSON.stringify(salesData, null, 2));
        console.error(`Error posting sales ${tipo} data:`, error.response?.data || error.message);
        return;
      }
    } else {
      console.log(`Ya existe la ${tipo}: ${salesData.no}`);
    }
  }

  extractNumber(input: string): string | null {
    input = input.toUpperCase();
    const match = input.match(/[TM]--(\d{3})/);
    return match ? match[1] : null;
  }
  async deleteControlTableEntry(database: string, idFactura: string) {
    let sqlDelete = `DELETE FROM recordsFacturacioBC WHERE IdFactura = '${idFactura}'`;
    await this.sql.runSql(sqlDelete, database);
  }
}
