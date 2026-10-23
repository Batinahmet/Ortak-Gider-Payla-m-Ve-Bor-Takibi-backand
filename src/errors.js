// API hataları: status kodu ve kullanıcıya gösterilecek mesajı taşır.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);
