import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaService } from './salesSilema.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaController {
  constructor(private readonly salesSilemaService: salesSilemaService) { }

  @Post('syncSalesSilemaDateTurno')
  async salesSilemaDateTurno(@Body() params: any) {
    const { dayStart, dayEnd, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno } = params;
    let res = await this.salesSilemaService.syncSalesSilemaDateTurno(dayStart, dayEnd, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Post('syncSalesSilema')
  async salesSilema(@Body() params: any) {
    const { day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno } = params;
    let res = await this.salesSilemaService.syncSalesSilema(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

}
