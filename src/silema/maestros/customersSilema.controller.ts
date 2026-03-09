import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { customersSilemaService } from './customersSilema.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class customersSilemaController {
  constructor(private readonly customersSilemaService: customersSilemaService) {}

  @Get('syncCustomersSilema')
  async syncCustomersSilema(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.customersSilemaService.syncCustomersSilema(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los contacts correctamente';
    else return 'Ha habido un error al sincronizar los contacts';
  }
}
