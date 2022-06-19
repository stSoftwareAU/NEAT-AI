import { ActivationInterface } from "./ActivationInterface.ts";

export class STEP implements ActivationInterface{
    
    public static NAME="STEP";
    
    getName(){
        return STEP.NAME;
    }

    squash( x:number){
        
        return x > 0 ? 1 : 0;
    }
    
    squashAndDerive(x:number){
        const fx = this.squash(x);

        return {
            activation: fx, 
            derivative: 0
        };        
    }
}