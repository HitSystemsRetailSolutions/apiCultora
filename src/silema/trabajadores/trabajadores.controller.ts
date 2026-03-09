import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { trabajadoresService } from './trabajadores.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class trabajadoresController {
  constructor(private readonly trabajadoresService: trabajadoresService) {}

  @Get('synctrabajadores')
  async signings(
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.trabajadoresService.syncTrabajadoresAC(database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los trabajadores correctamente';
    else return 'Ha habido un error al sincronizar los trabajadores';
  }
}
