import { ActivationInterface } from "./ActivationInterface.ts";

export class SOFTSIGN implements ActivationInterface{
    
    public static NAME="SOFTSIGN";
    
    getName(){
        return SOFTSIGN.NAME;
    }

    squash( x:number){        
        const d = 1 + Math.abs(x);
        return x / d;
    }
    
    squashAndDerive(x:number){
        const fx = this.squash(x);
        const d = 1 + Math.abs(x);
        
        return {
            activation: fx, 
            derivative:  x / Math.pow(d, 2)
        };        
    }
}