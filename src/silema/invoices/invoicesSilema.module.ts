import { Module } from '@nestjs/common';
import { intercompanySilemaController } from './intercompanySilema.controller';
import { intercompanySilemaService } from './intercompanySilema.service';
import { salesSilemaRecapManualController } from './salesSilemaRecapManual.controller';
import { salesSilemaRecapManualService } from './salesSilemaRecapManual.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [
        intercompanySilemaController,
        salesSilemaRecapManualController,
    ],
    providers: [
        intercompanySilemaService,
        salesSilemaRecapManualService,
    ],
})
export class InvoicesSilemaModule { }