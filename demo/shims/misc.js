// nodemailer и cookie-parser для демо-режима

// Письма не отправляются: уведомление попадает в журнал со статусом «outbox»
export function createTransport() {
  return { sendMail: async () => ({ message: '' }) };
}

// Куки уже разобраны оболочкой (demo/backend.js) и лежат в req.cookies
export function cookieParser() {
  return (_req, _res, next) => next();
}

// default-экспорт работает и как cookieParser(), и как nodemailer.createTransport()
const def = (...a) => cookieParser(...a);
def.createTransport = createTransport;
export default def;
