export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    name: process.env.DB_NAME || 'trucycle',
    ssl: process.env.DB_SSL === 'true',
    logging: process.env.DB_LOGGING === 'true',
    synchronize: process.env.TYPEORM_SYNC === 'true',
  },
});

