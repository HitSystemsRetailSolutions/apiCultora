import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaAbonoService } from './salesSilemaAbono.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaAbonoController {
  constructor(private readonly salesSilemaAbonoService: salesSilemaAbonoService) {}

  @Get('syncSalesSilemaAbono')
  async salesSilemaAbono(
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
    let res = await this.salesSilemaAbonoService.syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
