import { Bool, Field, PublicKey, Reducer } from 'o1js';
import { PulsarAction } from '../../types/PulsarAction.js';
import {
  ActionList,
  actionListAdd,
  emptyActionListHash,
  MerkleActions,
  merkleActionsAdd,
} from '../../types/actionHelpers.js';

const actions = [
  {
    actions: [
      [
        '1',
        '0',
        '0',
        '0',
        '0',
        '16',
        '3104281972354000915056163351062149601747057621462174588893187879456074329378',
        '3104281972354000915056163351062149601747057621462174588893187879456074329378',
        '0',
        '16',
        '4211676744195501373296418204530878450658653316492963013848942349129783238229',
      ],
    ],
    hash: '7315245504794914121033048068798584224066077411609555722768047943877462956834',
  },
  {
    actions: [
      [
        '2',
        '16592507347177959458998088479252903574637835747322054845697858853792031511648',
        '0',
        '10000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '22470038000152455914687340829806112872171966943045128611791546125724883800540',
  },
  {
    actions: [
      [
        '3',
        '16592507347177959458998088479252903574637835747322054845697858853792031511648',
        '0',
        '1000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '10357938191226907570187598004334962922712083755677946510912012627633921091034',
  },
  {
    actions: [
      [
        '3',
        '27750034997725126241594824087008798003612349410235896975514831636549608484321',
        '0',
        '2000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '12588758878334754409646495796842477698228747092927448808472805672956663817097',
  },
  {
    actions: [
      [
        '3',
        '8260423124804372776295995780707687473217394848337671404531921632984537916513',
        '1',
        '3000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '2527744150127236282043507772910959644734980206555956422452881349553529419187',
  },
  {
    actions: [
      [
        '3',
        '19361665089610746518180203678276968344465994501999915013361314859425868943113',
        '0',
        '4000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '2726423981287277883529929509685078425346187752903958575051142257074024459046',
  },
  {
    actions: [
      [
        '3',
        '10558102503062790529977548947140618532615266124694016658319121428873262020496',
        '0',
        '5000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '17611636995412901758387972181439967645666157350043260385098129056440093099056',
  },
  {
    actions: [
      [
        '3',
        '16592507347177959458998088479252903574637835747322054845697858853792031511648',
        '0',
        '6000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '26623797798599580968285351359873009065607945569367651689921790847777098016910',
  },
  {
    actions: [
      [
        '3',
        '27750034997725126241594824087008798003612349410235896975514831636549608484321',
        '0',
        '7000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '25965485771291900167473061737064917693443267652045335420818178417428325216340',
  },
  {
    actions: [
      [
        '3',
        '8260423124804372776295995780707687473217394848337671404531921632984537916513',
        '1',
        '8000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '22802046725981451870670408156523308378867741382477309008938009833764764925774',
  },
  {
    actions: [
      [
        '3',
        '19361665089610746518180203678276968344465994501999915013361314859425868943113',
        '0',
        '9000000000',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
      ],
    ],
    hash: '26571710784269107345182238424422549657159204297563013465882485878649417789319',
  },
].map((rawAction) => {
  const [
    type,
    account,
    isOdd,
    amount,
    initialState,
    newState,
    initialMerkleListRoot,
    newMerkleListRoot,
    initialBlockHeight,
    newBlockHeight,
    rewardListUpdateHash,
  ] = rawAction.actions[0];

  return new PulsarAction({
    type: Field.from(type),
    account: PublicKey.from({
      x: Field.from(account),
      isOdd: Bool.fromFields([Field.from(isOdd)]),
    }),
    amount: Field.from(amount),
    initialState: Field.from(initialState),
    newState: Field.from(newState),
    initialMerkleListRoot: Field.from(initialMerkleListRoot),
    newMerkleListRoot: Field.from(newMerkleListRoot),
    initialBlockHeight: Field.from(initialBlockHeight),
    newBlockHeight: Field.from(newBlockHeight),
    rewardListUpdateHash: Field.from(rewardListUpdateHash),
  });
});

let actionLists = actions.map((action) => {
  return ActionList.from([action]);
});

let merkleList = MerkleActions.from(actionLists);

const instanceIterator = merkleList.startIterating();
while (!instanceIterator.isAtEnd().toBoolean()) {
  console.log(instanceIterator.next().hash.toString());
}

let actionLists2 = actions.map((action) => {
  return actionListAdd(emptyActionListHash, action);
});

console.log(
  'Action List Hashes:',
  actionLists2.map((hash) => hash.toString())
);

let merkleList2 = [];
let acc = Reducer.initialActionState;

for (const actionHash of actionLists2) {
  acc = merkleActionsAdd(acc, actionHash);
  merkleList2.push(acc);
}

console.log(
  'Merkle List Hash:',
  merkleList2.map((hash) => hash.toString())
);
