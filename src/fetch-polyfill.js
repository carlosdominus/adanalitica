const safeFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;
const safeHeaders = typeof window !== 'undefined' ? window.Headers : null;
const safeRequest = typeof window !== 'undefined' ? window.Request : null;
const safeResponse = typeof window !== 'undefined' ? window.Response : null;

export default safeFetch;
export const Headers = safeHeaders;
export const Request = safeRequest;
export const Response = safeResponse;
