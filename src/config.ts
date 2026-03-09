/*import dotenv from 'dotenv';
dotenv.config();

// Variables de entorno
let user: string | undefined = process.env.USER;
let password: string | undefined = process.env.PASSWORD;
let server: string | undefined = process.env.SERVER;
let database: string | undefined = process.env.DATABASE;
let baseURL: string | undefined = process.env.BASE_URL;
let companyID: string | undefined = process.env.COMPANY_ID; // Permitimos la modificación
let tenant: string | undefined = process.env.TENANT;
let tokenType: string | undefined = process.env.TOKEN_TYPE;
let grantType: string | undefined = process.env.GRANT_TYPE;
let clientId: string | undefined = process.env.CLIENT_ID;
let clientSecret: string | undefined = process.env.CLIENT_SECRET;
let scope: string | undefined = process.env.SCOPE;

// Define el objeto de configuración
const config = {
    // Getters y setters para las variables de entorno
    get user() {
        return user;
    },
    set user(value: string | undefined) {
        user = value;
    },
    get password() {
        return password;
    },
    set password(value: string | undefined) {
        password = value;
    },
    get server() {
        return server;
    },
    set server(value: string | undefined) {
        server = value;
    },
    get database() {
        return database;
    },
    set database(value: string | undefined) {
        database = value;
    },
    get baseURL() {
        return baseURL;
    },
    set baseURL(value: string | undefined) {
        baseURL = value;
    },
    get companyID() {
        return companyID;
    },
    set companyID(value: string | undefined) {
        companyID = value;
    },
    get tenant() {
        return tenant;
    },
    set tenant(value: string | undefined) {
        tenant = value;
    },
    get tokenType() {
        return tokenType;
    },
    set tokenType(value: string | undefined) {
        tokenType = value;
    },
    get grantType() {
        return grantType;
    },
    set grantType(value: string | undefined) {
        grantType = value;
    },
    get clientId() {
        return clientId;
    },
    set clientId(value: string | undefined) {
        clientId = value;
    },
    get clientSecret() {
        return clientSecret;
    },
    set clientSecret(value: string | undefined) {
        clientSecret = value;
    },
    get scope() {
        return scope;
    },
    set scope(value: string | undefined) {
        scope = value;
    }
};

// Hacer que las variables sean estáticas excepto database y companyID
Object.defineProperty(config, 'user', { writable: false });
Object.defineProperty(config, 'password', { writable: false });
Object.defineProperty(config, 'server', { writable: false });
Object.defineProperty(config, 'baseURL', { writable: false });
Object.defineProperty(config, 'tenant', { writable: false });
Object.defineProperty(config, 'tokenType', { writable: false });
Object.defineProperty(config, 'grantType', { writable: false });
Object.defineProperty(config, 'clientId', { writable: false });
Object.defineProperty(config, 'clientSecret', { writable: false });
Object.defineProperty(config, 'scope', { writable: false });

// Hacer que database y companyID sean mutables
Object.defineProperty(config, 'database', { writable: true });
Object.defineProperty(config, 'companyID', { writable: true });

// Exporta el objeto de configuración
export default config;
*/
