import 'dotenv/config';
import app from './src/app';

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`DrawProof API running on port ${PORT} [${process.env.NODE_ENV}]`);
});
