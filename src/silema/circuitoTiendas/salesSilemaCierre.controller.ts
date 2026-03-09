import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaCierreService } from './salesSilemaCierre.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaCierreController {
  constructor(private readonly salesSilemaCierreService: salesSilemaCierreService) {}

  @Get('syncSalesSilemaCierre')
  async syncSalesSilemaCierre(
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
    let res = await this.salesSilemaCierreService.syncSalesSilemaCierre(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
