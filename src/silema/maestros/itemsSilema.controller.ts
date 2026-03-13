import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { itemsSilemaService } from './itemsSilema.service';
@Controller()
export class itemsSilemaController {
  constructor(private readonly itemsSilemaService: itemsSilemaService) { }
  @Post('syncItemsSilema')
  async syncItemsSilema(@Body() params: any) {
    const { companyID, database, client_id, client_secret, tenant, entorno } = params;
    let res = await this.itemsSilemaService.syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los items correctamente';
    else return 'Ha habido un error al sincronizar los items';
  }
}
