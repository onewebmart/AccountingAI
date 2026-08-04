export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  mongodb: {
    uri:
      process.env.MONGODB_URI ??
      'mongodb://localhost:27017/ai_accounting?replicaSet=rs0&directConnection=true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    resetSecret: process.env.JWT_RESET_SECRET ?? 'dev-reset-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    resetExpiresIn: '15m',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/api/v1/auth/google/callback',
  },

  email: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.FROM_EMAIL ?? 'noreply@aibooks.in',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    bucket: process.env.S3_BUCKET ?? 'ai-accounting-docs',
    region: process.env.S3_REGION ?? 'ap-south-1',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    /** Vision model used for OCR of images and scanned PDFs. */
    visionModel: process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash',
    /** Text model used to turn OCR output into structured invoice JSON. */
    extractionModel: process.env.GEMINI_EXTRACTION_MODEL ?? 'gemini-2.5-flash',
  },

  storage: {
    /** "s3" for MinIO/S3, "local" to write under STORAGE_LOCAL_DIR. */
    driver: process.env.STORAGE_DRIVER ?? 'auto',
    localDir: process.env.STORAGE_LOCAL_DIR ?? '.storage',
  },

  urls: {
    api: process.env.API_URL ?? 'http://localhost:3001',
    web: process.env.WEB_URL ?? 'http://localhost:3000',
  },
});
