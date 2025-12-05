import { server } from './app.js';

const port = Number(process.env.PORT ?? 3000);

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});
