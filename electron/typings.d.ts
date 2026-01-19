declare module 'cap' {
  // Minimal shim so the backend can compile even when cap has no TS types.
  const cap: any
  export = cap
}
