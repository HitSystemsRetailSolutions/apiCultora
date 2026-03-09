import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaService } from './salesSilema.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaController {
  constructor(private readonly salesSilemaService: salesSilemaService) { }

  @Get('syncSalesSilemaDateTurno')
  async salesSilemaDateTurno(
    @Query('dayStart') dayStart: string,
    @Query('dayEnd') dayEnd: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botigas: Array<String>,
    @Query('turno') turno: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilemaDateTurno(dayStart, dayEnd, month, year, companyID, database, botigas, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncSalesSilema')
  async salesSilema(
    @Query('day') day: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('turno') turno: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilema(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

}
