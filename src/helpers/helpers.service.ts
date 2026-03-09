import { writeFile, readFile, copyFile, access } from 'fs/promises';
import { join } from 'path';
import { Mutex } from 'async-mutex';
import { constants } from 'fs';

export class helpersService {
    private readonly logsPath = join(__dirname, '../../logs/logs.json');
    private static readonly logMutex = new Mutex();

    async addLog(tienda, fecha: string, turno, tipo: 'info' | 'error' | 'warning' | 'debug', codigo: string, mensaje: string, origen: string = 'salesSilemaService', companyID?: string, entorno?: string) {
        const release = await helpersService.logMutex.acquire();
        try {
            const timestamp = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
            const newLog = { tienda, fecha, turno, tipo, codigo, mensaje, origen, timestamp, companyID, entorno };

            try {
                await access(this.logsPath, constants.F_OK);
            } catch {
                await writeFile(this.logsPath, '[]', 'utf8');
            }

            // Leer logs actuales
            let logs: any[] = [];
            try {
                const data = await readFile(this.logsPath, 'utf8');
                logs = JSON.parse(data);
            } catch {
                // Restaurar desde backup si está corrupto
                try {
                    const backup = await readFile(this.logsPath + '.bak', 'utf8');
                    logs = JSON.parse(backup);
                } catch {
                    logs = [];
                }
            }

            logs.push(newLog);

            // Crear backup
            try {
                await copyFile(this.logsPath, this.logsPath + '.bak');
            } catch { }

            // Guardar archivo
            await writeFile(this.logsPath, JSON.stringify(logs, null, 2), 'utf8');
        } finally {
            release();
        }
    }
    async cleanOldLogs() {
        console.log("🧹 Limpiando logs antiguos...");
        const release = await helpersService.logMutex.acquire();
        try {
            const logsPath = this.logsPath;

            try {
                await access(logsPath, constants.F_OK);
            } catch {
                return; // No existe el archivo, nada que limpiar
            }

            // Leer logs actuales
            let logs: any[] = [];
            try {
                const data = await readFile(logsPath, 'utf8');
                logs = JSON.parse(data);
            } catch {
                // Si está corrupto, intentar restaurar backup
                try {
                    const backup = await readFile(logsPath + '.bak', 'utf8');
                    logs = JSON.parse(backup);
                } catch {
                    logs = [];
                }
            }

            if (!Array.isArray(logs) || logs.length === 0) return;

            const now = new Date();
            const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

            // Filtrar logs que sean más recientes que 2 semanas
            const filteredLogs = logs.filter(log => {
                try {
                    if (!log.timestamp) return true;

                    const logDate = this.parseEsTimestamp(log.timestamp);
                    if (!logDate || isNaN(logDate.getTime())) return true;

                    return now.getTime() - logDate.getTime() <= twoWeeksMs;
                } catch {
                    return true;
                }
            });

            // Crear backup antes de escribir
            try {
                await copyFile(logsPath, logsPath + '.bak');
            } catch { }

            // Guardar los logs filtrados
            await writeFile(logsPath, JSON.stringify(filteredLogs, null, 2), 'utf8');

        } finally {
            release();
        }
    }
    parseEsTimestamp(ts: string): Date | null {
        if (!ts) return null;

        ts = ts.trim();

        const match = ts.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
        );

        if (!match) return null;

        const [
            ,
            dd,
            mm,
            yyyy,
            hh = '0',
            mi = '0',
            ss = '0'
        ] = match;

        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(mi),
            Number(ss)
        );
    }

    normalizeNIF(nif: string): string {
        if (!nif) return '';
        // Limpiar espacios y pasar a mayúsculas
        let normalized = nif.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Transformamos los patrones usando letra = [A-Z] y número = \d
        const patterns = [
            /^ES\d{8}[A-Z]$/,   // ES########@
            /^\d{8}[A-Z]$/,     // ########@
            /^ES[A-Z]\d{8}$/,   // ES@########
            /^[A-Z]\d{8}$/,     // @########
            /^ES[A-Z]\d{7}[A-Z]$/, // ES@#######@
            /^[A-Z]\d{7}[A-Z]$/,   // @#######@
            /^[A-Z]\d{8}[A-Z]$/,   // @########@
            /^[A-Z]\d{6}[A-Z]$/,   // @######@
            /^[A-Z]\d{5}[A-Z]$/,   // @#####@
            /^\d{7}[A-Z]$/,     // #######@
            /^\d{6}[A-Z]$/,     // ######@
            /^\d{5}[A-Z]$/,     // #####@
            /^[A-Z]\d{7}$/,     // @#######
            /^[A-Z]\d{6}$/,     // @######
            /^[A-Z]\d{5}$/      // @#####
        ];

        for (const pattern of patterns) {
            if (pattern.test(normalized)) return normalized;
        }

        throw new Error(`NIF inválido para BC: ${nif}`);
    }
}