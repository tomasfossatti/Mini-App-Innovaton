import { config } from "dotenv";

// Los tests usan siempre .env.test (base innovaton_test), nunca la base de desarrollo.
// TEST_DATABASE_URL permite apuntar a otra base *_test (p. ej. para correr suites en paralelo).
config({ path: ".env.test", override: true, quiet: true });
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
