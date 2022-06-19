import { ActivationInterface } from "./ActivationInterface.ts";

export class TANH implements ActivationInterface{
    
    public static NAME="TANH";
    
    getName(){
        return TANH.NAME;
    }

    squash( x:number){
        
        return Math.tanh(x);
    }
    
    squashAndDerive(x:number){
        const fx = this.squash(x);

        return {
            activation: fx, 
            derivative: 1 - Math.pow(fx, 2)
        };        
    }
}