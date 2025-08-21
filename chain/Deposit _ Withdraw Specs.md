**Pulsar Deposit / Withdraw TX Specs**

**Bridge Module (Cosmos)**

This is the description of the bridge module living in the Cosmos SDK

Constant:

* COMMISSION: Ratio Number 0.02

State:

* Vault: Tokens for payments  
* Withdrawal Balances: A Mapping of PublicKey / Number  
* Reward Balances: A Mapping of PublicKey / Number  
* Approved Action List: A list of Action Type  
  * (Action def. in Mina Smart Contract) [https://github.com/node101-io/pulsar/blob/main/contracts/src/types/PulsarAction.ts](https://github.com/node101-io/pulsar/blob/main/contracts/src/types/PulsarAction.ts)   
* Approved Action Hash: The merkle hash of “Approved Action List”  
* All Action Hash: The merkle hash of all actions sent to Mina chain until the “Settled Block Height”  
  * This info is the same as what is recorded on Mina smart contract for actions.  
* Settled Block Height: Number

Methods:

* lock\_for\_withdrawal()  
  * Amount: Token  
  * Sender: PublicKey  
  * Commission is taken\!\! If I send 100 Token, 100 \* (1 \- COMMISSION) is given on the Withdrawal Balances.  
* resolve\_actions()  
  * Input  
    * Next Block Height: Number  
    * Action List: PublicKey  
    * Merkle Witness  
    * Public Key  
  * Process:  
    * Verifies the action list’s integrity (with signer node)  
    * For loop dönüyorsun actionlar üzerinde: (process\_actions)  
      * Eğer deposit ise: Approved Action arrayine pushluyorsun, 2 hashi de güncelliyorsun, ve buradaki account’a gereken miktarda pMINA mintliyorsun. Eğer Mina public key registered değilse ignore et.   
        * **Ignore** ettiğin zaman balance değişmiyor, approved action array ve hash değişmiyor. AMA her zaman All Action Hash güncelleniyor  
        * Hash Güncelleme X hashine Y’yi eklemek için: X \= Hash(X, Y)  
      * Eğer withdrawal ise:  
        * Eğer adamın o kadar balanceı yoksa mappingde, **ignore**  
        * Eğer adamın balanceı varsa, balanceı azalt, approved action ve approved action hash ve all action hashe ekle.  
      * Eğer settlement ise direkt kabul et.  
        * Kabul etmek \= approved action ve approved action hash ve all action hashe eklemek:  
    * Settled Block Height \= Next Block Height  
    * Rewards mappinginde Public Key balanceı constant kadar arttır  
* get\_payment()  
  * PublicKey: PublicKey

**Utility Functions**

* process\_actions()   
  * This is the function we have to process a list of actions and update corresponding states  
  * During the process of withdrawals, it is approved and the balance is decreased.   
  * During the process of deposits, the deposit is minted with the ratio. 

**Deposit / Withdraw TX Journey**

Note: Both Deposit / Withdraw works in a very similar way. The only difference is the sending of Step 1, where it only exists for the withdrawal TX.

1. (This step only exists for withdraw) User submits a lock\_for\_withdrawal TX to the bridge module  
   1. The sent amount is taken from the user account and burnt inside the module.  
   2. Once the corresponding amount is burnt, the “Withdrawal Balances” state inside the module is increased for the corresponding user.  
   3. Note: For prover payment \- If user has requested for X balance, only 0.9 X is burnt and increased, the 0.1 X is   
2. The user sends a Mina TX for the deposit / withdrawal.  
   1. If Deposit: The amount of MINA is paid during this TX to the Pulsar Mina smart contract.  
   2. If Withdrawal: A constant amount of MINA is paid, only to be returned during reduce() method.  
   3. The submitted data is stored on the Mina smart contract as an action. Fields:  
      1. publicKey: Mina Public Key  
      2. amount: Amounts of MINA deposited  
3. (2.5 hours of hard finality is waited…)  
4. Prover Node gets finalized actions from the Mina smart contract and sends a resolve\_actions TX to the Pulsar chain.  
   1. This TX is a Pulsar chain. It is inside the “bridge” module in the Cosmos SDK.  
   2. Input Fields:  
      1. List of Actions  
      2. Next Block Height  
      3. Merkle Witness  
   3. The module performs the following steps:  
      1. Sends verify\_action\_list() to the the Signer Node[^1]:  
         1. verify\_action\_list Inputs:  
            1. settled\_block\_height (fetched from module state)  
            2. list\_of\_actions  
            3. next\_block\_height  
         2. Verifies the send action list is valid, returns True or False  
      2. If verify\_action\_list returns True, sent action list is “processed” with the utility function, process\_actions()  
   4. Once this call is complete, all payments are done. The only step left is to put this update in the Mina smart contract, which is where the settlement is finalized.   
5. Here, ideally we can include a signature for each approved state of the bridge module. If not, the Prover Node is responsible for requesting signatures  
6. Prover Node sends a reduce TX and updates the Mina Contract  
7. Once the Mina contract is updated, the Prover (and any party who generated a proof along the process) can go and claim their reward. 

[^1]:  Each Cosmos Node has its own respective Signer Node