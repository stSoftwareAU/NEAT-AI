import { ActivationInterface } from "./ActivationInterface.ts";

export class IDENTITY implements ActivationInterface{
    
    public static NAME="IDENTITY";
    
    getName(){
        return IDENTITY.NAME;
    }

    squash( x:number){
        
        return x;
    }
    
    squashAndDerive(x:number){
        const fx = this.squash(x);

        return {
            activation: fx, 
            derivative: 1
        };        
    }
}