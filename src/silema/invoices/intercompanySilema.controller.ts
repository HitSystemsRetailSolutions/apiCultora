import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { intercompanySilemaService } from './intercompanySilema.service';

@Controller()
export class intercompanySilemaController {
  constructor(private readonly intercompanySilemaService: intercompanySilemaService) {}

  @Get('syncIntercompanySilema')
  async syncIntercompanySilema(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string[],
    @Query('tabla') tabla: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.intercompanySilemaService.syncIntercompany(companyID, database, idFactura, tabla, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los items correctamente';
    else return 'Ha habido un error al sincronizar los items';
  }
}
