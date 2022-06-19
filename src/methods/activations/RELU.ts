import { ActivationInterface } from "./ActivationInterface.ts";

export class RELU implements ActivationInterface{
    
    public static NAME="RELU";
    
    getName(){
        return RELU.NAME;
    }

    squash( x:number){        
        return x > 0 ? x : 0;
    }
    
    squashAndDerive(x:number){
        const fx = this.squash(x);

        return {
            activation: fx, 
            derivative: x > 0 ? 1 : 0
        };        
    }
}