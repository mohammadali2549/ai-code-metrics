import { app } from './app.js';

const portEnv = process.env.PORT;
const port = typeof portEnv === 'string' ? Number(portEnv) || 3000 : 3000;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Subscriptions admin listening on http://localhost:${port}`);
});
