import { Injectable } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { helpersService } from 'src/helpers/helpers.service';

@Injectable()
export class checksService {
    constructor(
        private sql: runSqlService,
        private helpers: helpersService,
    ) { }

    async validateStore(botiga: string | number, day: string, month: string, year: string, turno: any, companyID: string, entorno: string, database: string, tipoLog: string): Promise<string | false> {
        // Comprobar si la tienda existe, es una tienda y si tiene el formato correcto
        let sqlCheckTienda = `
          SELECT c.codi, c.nom, p.Codi as esTienda 
          FROM clients c 
          LEFT JOIN ParamsHw p ON c.codi = p.Codi 
          WHERE c.codi = ${botiga}`;
        let queryTienda = await this.sql.runSql(sqlCheckTienda, database);

        if (queryTienda.recordset.length === 0) {
            await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'STORE_NOT_FOUND', `La tienda ${botiga} no existe en la tabla de clientes.`, tipoLog, companyID, entorno);
            console.error(`La tienda ${botiga} no existe en la tabla de clientes.`);
            return false;
        }

        if (queryTienda.recordset.length > 1) {
            await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'DUPLICATED_STORE', `La tienda ${botiga} está duplicada ${queryTienda.recordset.length} veces en la tabla de clientes. Abortando proceso para evitar importes multiplicados.`, tipoLog, companyID, entorno);
            console.error(`Tienda ${botiga} duplicada ${queryTienda.recordset.length} veces.`);
            return false;
        }

        if (!queryTienda.recordset[0].esTienda) {
            await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'NOT_A_STORE', `El código ${botiga} no existe en la tabla ParamsHw. No se considera una tienda válida.`, tipoLog, companyID, entorno);
            console.error(`El código ${botiga} no es una tienda válida (no existe en ParamsHw).`);
            return false;
        }

        const storeName = queryTienda.recordset[0].nom;
        const locationCode = this.extractNumber(storeName);
        if (!locationCode) {
            await this.helpers.addLog(botiga, `${day}-${month}-${year}`, turno, 'error', 'INVALID_STORE_NAME', `El nombre de la tienda '${storeName}' no tiene el formato esperado (T--### o M--###). El código de almacén sería NULL. Abortando proceso.`, tipoLog, companyID, entorno);
            console.error(`Nombre de tienda inválido: '${storeName}'.`);
            return false;
        }

        return locationCode;
    }

    extractNumber(input: string): string | null {
        input = input.toUpperCase();
        const match = input.match(/[TM]--(\d{3})/);
        return match ? match[1] : null;
    }

    async validaCaja(botiga: string | number, year, month, day, horaInicio, horaFin, database, turno): Promise<boolean> {

        let iTargetaDATAFONO = 0;
        let iTargeta = 0;
        let importZ = 0;
        let importVenut = 0;

        // ===========================
        // SALTOS DE TICKET
        // ===========================
        const tickets = await this.sql.runSql(
            `SELECT MIN(num_tick) AS primerTick, MAX(num_tick) AS ultimTick
                FROM [v_venut_${year}-${month}]
                WHERE botiga = ${botiga} AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'`, database)

        const primerTick = tickets?.recordset[0]?.primerTick;
        const ultimTick = tickets?.recordset[0]?.ultimTick;

        if (primerTick && ultimTick) {
            const countRes = await this.sql.runSql(
                `SELECT COUNT(DISTINCT num_tick) AS nTicks
                    FROM (
                        SELECT * FROM [v_venut_${year}-${month}]
                        UNION ALL
                        SELECT * FROM [V_Anulats_${year}-${month}]
                    ) v
                    WHERE botiga = ${botiga} AND num_tick BETWEEN ${primerTick} AND ${ultimTick}`, database
            );

            const nTicks = countRes.recordset[0]?.nTicks ?? 0;
            const esperat = ultimTick - primerTick + 1;
            if (nTicks !== esperat) {
                console.log('Saltos de ticket detectados', { primerTick, ultimTick, nTicks, esperat });
                await this.updateControlTableEntry(day, month, year, botiga, database, turno);
                return false;
            }
        }

        // ===========================
        // IMPORTE DATAFONO
        // ===========================
        const movDatafono = await this.sql.runSql(
            `SELECT ROUND(ABS(import), 2) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE botiga = ${botiga} AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}' AND tipus_moviment = 'DATAFONO'`, database
        );
        if (movDatafono.recordset[0]) iTargetaDATAFONO = movDatafono.recordset[0].import;

        const movTargeta = await this.sql.runSql(
            `SELECT ISNULL(ROUND(ABS(SUM(import)), 2),0) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'
                AND botiga = ${botiga}
                AND motiu LIKE 'Pagat Targeta:%'`, database
        );
        if (movTargeta.recordset[0]) iTargeta = movTargeta.recordset[0].import;

        if (Math.abs(iTargetaDATAFONO) !== Math.abs(iTargeta)) {
            console.log('Importes de datafono no coinciden', { iTargetaDATAFONO, iTargeta });
            // await this.updateControlTableEntry(day, month, year, botiga, database, turno);
            // return false;
        }

        // ===========================
        // VENTAS VS Z
        // ===========================
        const ventas = await this.sql.runSql(
            `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                FROM [v_venut_${year}-${month}]
                WHERE botiga=${botiga} AND DAY(Data)=${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'`, database
        );
        const zMovements = await this.sql.runSql(
            `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE botiga = ${botiga}
                AND Tipus_moviment = 'Z'
                AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'
                AND Import > 0`, database
        );
        if (ventas.recordset[0]) importVenut = ventas.recordset[0].import;

        if (zMovements.recordset[0]) importZ = zMovements.recordset[0].import;

        if (Math.abs(importZ - importVenut) > 0.01) {
            console.log('Importe de ventas y Z no coinciden', { importZ, importVenut });
            await this.updateControlTableEntry(day, month, year, botiga, database, turno);
            return false;
        }

        return true;
    }
    async updateControlTableEntry(day: string, month: string, year: string, botiga, database, turno?: number) {
        let sqlUpdate = `
        UPDATE RecordsBC SET EstatTraspas = 2
        WHERE day(TmStCaixa) = '${day}' AND month(TmStCaixa) = '${month}' AND year(TmStCaixa) = '${year}' AND Botiga = '${botiga}'`;
        if (turno !== undefined) {
            sqlUpdate += ` AND Torn = ${turno}`;
        }
        await this.sql.runSql(sqlUpdate, database);
    }
}
