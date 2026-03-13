import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class intercompanySilemaService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  // Funcion que pasandole un dia de inicio y otro de fin sincroniza los datos de ventas de silema
  async syncIntercompany(companyID: string, database: string, idFacturas: string[], tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    const tipo = 'Factura intercompany';
    const tabFacturacioIVA = `[FACTURACIO_${tabla}_IVA]`;
    const tabFacturacioDATA = `[FACTURACIO_${tabla}_DATA]`;
    let i = 1;
    for (const idFactura of idFacturas) {
      const sqlQ = `SELECT * FROM ${tabFacturacioIVA} f left join clients c on f.clientcodi = c.codi WHERE idFactura = '${idFactura}'`;
      const cabecerafacturas = await this.sql.runSql(sqlQ, database);

      if (cabecerafacturas.recordset.length === 0) {
        console.warn(`⚠️ Factura con ID ${idFactura} no encontrada en la base de datos.`);
        continue;
      }

      const x = cabecerafacturas.recordset[0];

      const cutoffDate = new Date(2026, 0, 1); // 01/01/2026
      const facturaDate = new Date(x.DataFactura);

      if (facturaDate < cutoffDate) {
        console.log(`⏭️ Factura ${idFactura} con fecha ${facturaDate.toISOString().substring(0, 10)} anterior a 01/01/2026. Se omite sincronización y se elimina control.`);
        await this.deleteControlTableEntry(database, idFactura);
        continue;
      }

      let num = x.Serie.length <= 0 ? x.NumFactura : x.Serie + x.NumFactura;
      let dataFi = x.DataFi.toISOString().substring(0, 10);
      let dataInici = x.DataInici.toISOString().substring(0, 10);
      let dataFactura = x.DataFactura.toISOString().substring(0, 10);
      let dueDate = x.DataVenciment.toISOString().substring(0, 10);
      console.log(`-------------------SINCRONIZANDO FACTURA NÚMERO ${num} -----------------------`);

      const esTienda = await this.sql.runSql(`SELECT * FROM ParamsHw WHERE codi = '${x.ClientCodi}'`, database);
      const isShop = esTienda.recordset && esTienda.recordset.length > 0;

      let salesData = {
        no: `${num}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${dueDate}`, // Fecha vencimiento
        externalDocumentNo: `${num}`, // Nº documento externo
        intercompanyGraellas: true, // Graella intercompany
        locationCode: isShop ? `${this.extractNumber(x.Nom)}` : '000', // Cód. almacén
        orderDate: `${dataInici}`, // Fecha pedido
        postingDate: `${dataFactura}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        manualRecapInvoice: false, // Factura manual
        remainingAmount: 0, // Precio total incluyendo IVA por factura
        amountExclVat: 0, // Precio total sin IVA por factura
        vatAmount: 0, // IVA total por factura
        shipToCode: isShop ? `${this.extractNumber(x.Nom)}` : '', // Cód. dirección envío cliente
        storeInvoice: false, // Factura tienda
        vatRegistrationNo: `${x.ClientNif}`, // CIF/NIF
        invoiceStartDate: `${dataInici}`, // Fecha inicio facturación
        invoiceEndDate: `${dataFi}`, // Fecha fin facturación
        documentDate: `${dataInici}`, // Fecha factura
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };

      salesData = await this.processInvoiceLines(salesData, database, idFactura, tabFacturacioDATA, isShop);
      // console.log(`Factura: `, salesData);
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token, database, idFactura);
    }

    return true;
  }

  async processInvoiceLines(salesData, database, idFactura, tabFacturacioDATA, isShop: boolean) {
    const sqlQ2 = `;WITH LineasBase AS (
                          SELECT 
                              f.Data,
                              f.Producte,
                              f.Desconte AS Descuento,
                              f.Iva,
                              f.ProducteNom AS Nombre,
                              c.Nom AS Client,
                              COALESCE(f.Preu,0) as Preu,
                              f.Referencia,
                              CAST(f.Producte AS VARCHAR(20)) AS Plu,
                              SUM(
                                  CASE 
                                      WHEN f.Servit = 0 THEN f.Tornat * -1
                                      ELSE f.Servit 
                                  END
                              ) AS Quantitat
                          FROM ${tabFacturacioDATA} f
                          LEFT JOIN clients c ON f.client = c.codi
                          WHERE f.idFactura = '${idFactura}'
                          GROUP BY f.Data, f.Producte, f.Desconte, f.Iva, f.ProducteNom, c.Nom, f.Preu, f.Referencia
                      ),
                      LineasExt AS (
                          SELECT 
                              CASE 
                                  WHEN CHARINDEX('IdAlbara:', Referencia) > 0 THEN 
                                      SUBSTRING(
                                          Referencia,
                                          CHARINDEX('IdAlbara:', Referencia) + 9,
                                          CHARINDEX(']', Referencia, CHARINDEX('IdAlbara:', Referencia)) 
                                              - CHARINDEX('IdAlbara:', Referencia) - 9
                                      )
                                  ELSE NULL 
                              END AS IdAlbara,
                              CASE 
                                  WHEN CHARINDEX('IBEE:', Referencia) > 0 THEN 
                                      TRY_CAST(
                                          SUBSTRING(
                                              Referencia,
                                              CHARINDEX('IBEE:', Referencia) + 5,
                                              CHARINDEX(']', Referencia, CHARINDEX('IBEE:', Referencia)) 
                                                - CHARINDEX('IBEE:', Referencia) - 5
                                          ) AS FLOAT
                                      )
                                  ELSE 0.0
                              END AS ValorIBEE,
                              Client,
                              CAST(Data AS DATE) AS Data,
                              Plu,
                              Descuento,
                              Iva,
                              Nombre,
                              Preu,
                              COALESCE(
                                  RIGHT(Referencia, CHARINDEX(']', REVERSE(Referencia)) - 1),
                                  ''
                              ) AS Comentario,
                              Quantitat
                          FROM LineasBase
                      )
                      SELECT
                          L1.Data AS Data,
                          L1.IdAlbara,
                          L1.Client,
                          L1.Plu,
                          L1.Nombre,
                          SUM(L1.Quantitat) AS Quantitat,
                          ROUND(MIN(L1.Preu) , 5) AS UnitPrice,
						              ROUND(MIN(L1.Preu * (1 - L1.Descuento/100.0)), 5) AS UnitPriceDesc,
                          ROUND(MIN(L1.Preu * (1 + L1.Iva/100.0)), 5) AS UnitPriceIVA,
						              ROUND(MIN(L1.Preu * (1 - L1.Descuento/100.0) * (1 + L1.Iva/100.0)), 5) AS UnitPriceIVADesc,
                          ROUND(SUM(L1.Preu * L1.Quantitat), 5) AS ImporteTotalLinea,
                          ROUND(SUM(L1.Preu * (1 - L1.Descuento/100.0) * L1.Quantitat), 5) AS ImporteTotalLineaDesc,
                          ROUND(SUM(L1.Preu * (1 + L1.Iva/100.0) * L1.Quantitat), 5) AS ImporteTotalLineaIVA,
                          ROUND(SUM(L1.Preu * (1 - L1.Descuento/100.0) * (1 + L1.Iva/100.0) * L1.Quantitat), 5) AS ImporteTotalLineaIVADesc,
                          ROUND(SUM(L1.Preu * (1 - L1.Descuento/100.0) * (L1.Iva/100.0) * L1.Quantitat), 5) AS CuotaIVA,
                          L1.Descuento,
                          L1.Iva,
                          ROUND(SUM(L1.ValorIBEE * L1.Quantitat), 5) AS BaseIBEE,
                          ROUND(SUM(L1.ValorIBEE * L1.Quantitat * (10 / 100.0)), 5) AS CuotaIBEE,
                          STUFF(
                              (
                                  SELECT ' / ' + L2.Comentario
                                  FROM LineasExt L2
                                  WHERE ISNULL(L2.IdAlbara, '') = ISNULL(L1.IdAlbara, '')
                                    AND L2.Client = L1.Client
                                    AND L2.Data = L1.Data
                                    AND L2.Plu = L1.Plu
                                  FOR XML PATH(''), TYPE
                              ).value('.', 'NVARCHAR(MAX)'),
                              1,
                              3,
                              ''
                          ) AS Comentario
                      FROM LineasExt L1
                      GROUP BY L1.IdAlbara, L1.Client, L1.Data, L1.Plu, L1.Descuento, L1.Iva, L1.Nombre
                      ORDER BY L1.Nombre, L1.Data, L1.IdAlbara, L1.Client;`;

    const invoiceLines = await this.sql.runSql(sqlQ2, database);
    if (invoiceLines.recordset.length === 0) {
      console.warn(`⚠️ No se encontraron líneas de factura para la ID ${idFactura}.`);
      return salesData;
    }
    let countLines = 1;
    let totalBase = 0;
    let totalCuota = 0;
    let totalCuotaIBEE = 0;
    let totalBaseIBEE = 0;
    let total = 0;
    for (const line of invoiceLines.recordset) {
      let isoDate = line.Data.toISOString().substring(0, 10);
      line.Iva = `IVA${String(line.Iva).replace(/\D/g, '').padStart(2, '0')}`;
      if (line.Iva === 'IVA00') line.Iva = 'IVA0';
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${line.Plu}`,
        lineNo: countLines,
        description: `${line.Nombre}`,
        lineDiscount: parseFloat(line.Descuento),
        quantity: parseFloat(line.Quantitat),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(line.ImporteTotalLineaIVA),
        lineAmountExclVat: parseFloat(line.ImporteTotalLinea),
        vatProdPostingGroup: `${line.Iva}`,
        unitPrice: parseFloat(line.UnitPriceIVA),
        unitPriceExclVat: parseFloat(line.UnitPrice),
        locationCode: isShop ? `${this.extractNumber(line.Client)}` : '000',
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLine);
      totalBase += parseFloat(line.ImporteTotalLineaDesc);
      totalCuota += parseFloat(line.CuotaIVA);
      totalCuotaIBEE += parseFloat(line.CuotaIBEE);
      totalBaseIBEE += parseFloat(line.BaseIBEE);
    }
    totalBase = totalBase + totalBaseIBEE;
    totalCuota = totalCuota + totalCuotaIBEE;
    totalBase = Math.round(totalBase * 1000) / 1000;
    totalCuota = Math.round(totalCuota * 1000) / 1000;
    totalCuotaIBEE = Math.round(totalCuotaIBEE * 1000) / 1000;
    totalBaseIBEE = Math.round(totalBaseIBEE * 1000) / 1000;
    console.log(`Total Base: ${totalBase}`);
    console.log(`Total Cuota IVA: ${totalCuota}`);
    totalBase = Math.round(totalBase * 100) / 100;
    totalCuota = Math.round(totalCuota * 100) / 100;

    total = totalBase + totalCuota;
    let salesIBEELine = {
      documentNo: `${salesData.no}`,
      type: `Item`,
      no: `IBEE`,
      lineNo: countLines,
      description: `IBEE`,
      quantity: 1,
      shipmentDate: `${salesData.invoiceEndDate}`,
      lineTotalAmount: totalBaseIBEE + totalCuotaIBEE,
      lineAmountExclVat: totalBaseIBEE,
      vatProdPostingGroup: `IBEE`,
      unitPrice: totalBaseIBEE + totalCuotaIBEE,
      unitPriceExclVat: totalBaseIBEE,
      locationCode: isShop ? `${salesData.shipToCode}` : '000',
    };
    salesData.salesLinesBuffer.push(salesIBEELine);
    countLines++;
    salesData.remainingAmount = parseFloat(total.toFixed(2));
    salesData.amountExclVat = totalBase;
    salesData.vatAmount = totalCuota;

    console.log(`Base: ${totalBase}`);
    console.log(`Cuota IVA: ${totalCuota}`);
    console.log(`Base IBEE: ${totalBaseIBEE}`);
    console.log(`Cuota IBEE: ${totalCuotaIBEE}`);
    console.log(`Total: ${parseFloat(total.toFixed(2))}`);

    return salesData;
  }
  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
  async postToApi(tipo, salesData, tenant, entorno, companyID, token, database?: string, idFactura?: string) {
    if (salesData.no.length > 20) salesData.no = salesData.no.slice(-20);
    if (salesData.locationCode.length > 10) salesData.locationCode = salesData.locationCode.slice(-10);
    if (salesData.shipToCode.length > 10) salesData.shipToCode = salesData.shipToCode.slice(-10);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter= no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
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
      if (database && idFactura) {
        await this.deleteControlTableEntry(database, idFactura);
        console.log(`🗑️ Registro eliminado de recordsFacturacioBC para la factura ${idFactura}`);
      }
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
