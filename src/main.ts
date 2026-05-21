import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(3335);
}
bootstrap();

const axios = require('axios');
axios.defaults.baseURL = 'http://localhost:3335';
var debug = true; //debug: mqtt publish
const mqtt = require('mqtt');
const { config } = require('process');

const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
let client;
try {
  if (!process.env.MQTT_HOST) {
    console.warn('⚠️ MQTT_HOST no está definido en las variables de entorno. El cliente MQTT podría no conectar.');
  }
  client = mqtt.connect(mqttOptions);

  // Manejar evento de conexión
  client.on('connect', function () {
    console.log('✅ Conectado al broker MQTT');

    // Suscribirse a un tema
    const tema = [
      '/Hit/Serveis/Apicultor',
      '/Hit/Serveis/Apicultora'
    ];
    // let tema = '/Testinggg/Hit/Serveis/Apicultor';
    client.subscribe(tema, function (err) {
      if (err) {
        console.error('❌ Error al suscribirse a los temas:', tema, err);
      } else {
        console.log('✅ Suscripción exitosa a los temas:', tema);
      }
    });
  });
} catch (error) {
  console.error('🔥 Error crítico al intentar inicializar el cliente MQTT', error);
}
// Manejar mensajes recibidos
client.on('message', async function (topic, message) {
  if (debug) {
    console.log('Mensaje recibido en el tema:', topic, '- Contenido:', message.toString());
  }
  try {
    const msgJson = JSON.parse(message);
    console.log('Mensaje en modo JSON:', msgJson);

    // DEBUG
    const debug = msgJson.debug === 'true';
    console.log(`Debug: ${debug ? 'activado' : 'desactivado'}`);

    // TEST
    const test = msgJson.test === 'true';
    console.log(`Test: ${test ? 'activado' : 'desactivado'}`);

    // COMPANY
    let companyID = msgJson.companyID || '';
    let companyNAME = msgJson.companyNAME ?? msgJson.companyName ?? '';

    if (companyID) {
      if (!isValidCompanyID(companyID)) {
        mqttPublish('Error: "companyID" no valido');
        return;
      }
    } else if (!companyNAME) {
      mqttPublish('El JSON recibido no tiene el campo "companyID" o "companyNAME"');
    }

    // DATABASE
    let database = msgJson.database ?? msgJson.dataBase;
    if (!database) {
      mqttPublish('El JSON recibido no tiene el campo "database"');
    }

    // ENVIRONMENT VARIABLES
    const client_id = msgJson.client_id || process.env.client_id;
    const client_secret = msgJson.client_secret || process.env.client_secret;
    const tenant = msgJson.tenant || process.env.tenant;
    const entorno = msgJson.entorno || process.env.entorno;

    const nif = msgJson.nif || '';
    const turno = msgJson.turno || 0;

    if (!test) {
      const actions = {
        SyncSignings: () => callSync('syncSignings', { companyNAME, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de fichajes acabada'),
        signings: () => callSync('syncSignings', { companyNAME, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de fichajes acabada'),
        SyncTrabajadores: () => callSync('syncTrabajadores', { database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de trabajadores acabada'),
        trabajadores: () => callSync('syncTrabajadores', { database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de trabajadores acabada'),

        silemaDateTurno: () => callSync('syncSalesSilemaDateTurno', { dayStart: msgJson.dayStart, dayEnd: msgJson.dayEnd, month: msgJson.month, year: msgJson.year, companyID, database, botiga: msgJson.botiga, turno, client_id, client_secret, tenant, entorno }, '✅ Sincronización de ventas Silema por fecha y turno acabada'),
        silema: () => callSync('syncSalesSilema', { day: msgJson.day, month: msgJson.month, year: msgJson.year, companyID, database, botiga: msgJson.botiga, turno, client_id, client_secret, tenant, entorno }, '✅ Sincronización de ventas Silema acabada'),
        silemaAbono: () => callSync('syncSalesSilemaAbono', { day: msgJson.day, month: msgJson.month, year: msgJson.year, companyID, database, botiga: msgJson.botiga, turno, client_id, client_secret, tenant, entorno }, '✅ Sincronización de abonos Silema acabada'),
        silemaCierre: () => callSync('syncSalesSilemaCierre', { day: msgJson.day, month: msgJson.month, year: msgJson.year, companyID, database, botiga: msgJson.botiga, turno, client_id, client_secret, tenant, entorno }, '✅ Sincronización de cierre Silema acabada'),
        silemaRecap: () => callSync('syncSalesSilemaRecapManual', { idFactura: msgJson.idFactura, tabla: msgJson.tabla, companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de recap Silema acabada'),
        silemaRecapManual: () => callSync('syncSalesSilemaRecapManual', { idFactura: msgJson.idFactura, tabla: msgJson.tabla, companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de recap manual Silema acabada'),
        silemaIntercompany: () => callSync('syncIntercompanySilema', { companyID, database, idFactura: msgJson.idFactura, tabla: msgJson.tabla, client_id, client_secret, tenant, entorno }, '✅ Sincronización de intercompany Silema acabada'),
        silemaItems: () => callSync('syncItemsSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de artículos Silema acabada'),
        silemaCustomers: () => callSync('syncCustomersSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de clientes Silema acabada'),
        silemaContacts: () => callSync('syncContactsSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de contactos Silema acabada'),
        silemaVendors: () => callSync('syncVendorsSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de proveedores Silema acabada'),
        silemaLocations: () => callSync('syncLocationSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de almacenes Silema acabada'),
        maestros: async () => {
          await callSync('syncCustomersSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de clientes Silema acabada');
          await callSync('syncVendorsSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de proveedores Silema acabada');
          await callSync('syncLocationSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de almacenes Silema acabada');
        },
        maestrosNoCustomers: async () => {
          await callSync('syncLocationSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de almacenes Silema acabada');
          await callSync('syncVendorsSilema', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de proveedores Silema acabada');
        },
        runSincroIntercompanyCron: () => callSync('cronIntercompanySync', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Job de revisión periódica de Intercompany finalizado'),
        intercompanyTuesdayCron: () => callSync('cronIntercompanyFirstTuesdaySync', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Job de sincronización Intercompany del primer martes finalizado'),
      };

      // Ejecutar acción según el mensaje
      if (actions[msgJson.msg]) {
        await actions[msgJson.msg]();
      } else {
        mqttPublish('Mensaje recibido no coincide con ninguna acción esperada');
      }
    } else {
      console.log('Testing: ', test);
    }
  } catch (error) {
    if (debug) {
      console.log('Mensaje recibido como una cadena');
    }
    console.error('Error al procesar el mensaje:', error);
  }
});

// Manejar errores
client.on('error', function (error) {
  console.error('❌ Error en el cliente MQTT:', error);
});

client.on('reconnect', () => {
  console.log('🔄 Reintentando conexión MQTT...');
});

client.on('offline', () => {
  console.log('🔌 Cliente MQTT offline');
});

function isValidCompanyID(companyID) {
  // Expresión regular para validar el formato del companyID
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(companyID);
}

async function callSync(endpoint, params, successMsg) {
  console.log(`🔄 Llamando a la función de sincronización: ${endpoint}`);
  try {
    await axios.post(endpoint, params);
    console.log(successMsg);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error al sincronizar en ${endpoint}: ${errorMessage}`);
  }
}

function mqttPublish(msg) {
  if (debug) client.publish('/Hit/Serveis/Apicultor/Log', msg);
}

export { mqttPublish };
