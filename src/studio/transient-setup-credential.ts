/** Owns only the pre-dispatch reference. Release is not secure JS-string erasure. */
export class TransientSetupCredential {
 #value:string;
 constructor(value:string){this.#value=value;}
 take(){const value=this.#value;this.#value='';return value;}
 release(){this.#value='';}
}
