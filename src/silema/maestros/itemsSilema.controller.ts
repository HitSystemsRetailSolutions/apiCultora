import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { itemsSilemaService } from './itemsSilema.service';
@Controller()
export class itemsSilemaController {
  constructor(private readonly itemsSilemaService: itemsSilemaService) { }
  @Get('syncItemsSilema')
  async syncItemsSilema(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.itemsSilemaService.syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los items correctamente';
    else return 'Ha habido un error al sincronizar los items';
  }
}
