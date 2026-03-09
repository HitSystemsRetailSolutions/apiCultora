import { Module } from '@nestjs/common';
import { contactsSilemaController } from './contactsSilema.controller';
import { contactsSilemaService } from './contactsSilema.service';
import { customersSilemaController } from './customersSilema.controller';
import { customersSilemaService } from './customersSilema.service';
import { itemsSilemaController } from './itemsSilema.controller';
import { itemsSilemaService } from './itemsSilema.service';
import { locationSilemaController } from './locationSilema.controller';
import { locationSilemaService } from './locationSilema.service';
import { vendorsSilemaController } from './vendorsSilema.controller';
import { vendorsSilemaService } from './vendorsSilema.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [
        contactsSilemaController,
        customersSilemaController,
        itemsSilemaController,
        locationSilemaController,
        vendorsSilemaController,
    ],
    providers: [
        contactsSilemaService,
        customersSilemaService,
        itemsSilemaService,
        locationSilemaService,
        vendorsSilemaService,
    ],
})
export class MaestrosSilemaModule { }
