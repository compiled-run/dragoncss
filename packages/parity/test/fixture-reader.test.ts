// The fixture reader (packages/parity/src/fixture-reader.ts): HTML void elements, a <link rel="stylesheet"> resolved into a
// snapshot source, and reader identity: the FrontEndResult of every fixture present at BASE (12af7cb) is byte-identical, pinned
// by the sha256 of its canonical JSON computed at BASE before the reader changed.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../dragon/src/digest.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { fixtureToInput, parseFixtureHtml, readHtmlFixture, VOID_ELEMENTS } from '../src/fixture-reader.ts';
import type { TreeFixtureFile } from '../src/tree-fixture.ts';
import { readTreeFixture, readTreeFixtureDir } from '../src/tree-fixture.ts';

/** sha256 of canonicalJson(FrontEndResult) per fixture, at BASE 12af7cb. */
const BASE_DIGESTS: Readonly<Record<string, string>> = {
  'block-ua-divs': '8669ba7e31d26a6f997b930952171065b36377fd81a97bcf7f415859ce0e9898',
  'block-content-box-padding-border': 'a24d2d3b95e6ead72d1ce20606547e314ae9ece0a8d152dd6fcc0d3505ff0ca0',
  'block-border-box': '17cc86a7a62777d436c26b6a0b4e5248188078719fb37b78b044bbf33b120dc5',
  'block-percent-width-padding': '5a82c8e674f5a9f0bbd2b0ee0ab8d1348eb26cd2ab5092916c4e66f964f35f13',
  'block-min-max': '31ea442d142fc9005f6746db0d9389059855c889b686497f4548dbe310dac40a',
  'block-auto-margin-center': 'f08ad57800b485e7d72cd1aa7f426562eae1b126639daad81af418346868d6c8',
  'flex-row-grow-shrink-basis': '7519c1c51a6f48a7dbfe03f89ec10f22c3ad1c83dcd690ccb07a102fd60b172c',
  'flex-min-max-freeze': 'f3039cf9825bdd8ff86a3a25c26fd257777411a28d27267a04cf6d0f09fb52e2',
  'flex-column': '01ae8b8e920e383ab4ff0472d3af1440f253c3a9e45aa3fc3a5521a9738c86de',
  'flex-wrap-gap-align-content': 'e729b00b7f9497681b8a777f3cb20cf8beb280c5397f0d3556ee25bd0a30bf20',
  'flex-justify-content': '0c2ba59bb02955061e111370dd2dc3accce23f966c02582b73dedb6091e189d1',
  'flex-align-items-stretch-center': '6a8d15b537e132c23ff0143114e856c6068dbcfde9ae308f2f27fd18733b1bc2',
  'text-ahem-single-line': '225f5031627035919f15b3bbeee218b1951b7e2327d55e92a0020bac5e56eb09',
  'color-syntax': 'de899b555eefc8e6ed104fc89fa69996b4b5cf846954c780388e6882739377d9',
  'color-border-sides': '0a9f0be51f0cae1703b9d65b63e3cd9e0fc10b945d1ae7083154345367cee16d',
  'cascade-compound-variants': 'fae07227ffeeb8e858f9bff3e4d58cbfb0f76a932ea1abb42ec7de469885e35b',
  'block-fractional-values': '77e28791e7871ef55626c9d981ae1fab8fd8e8092e5d9b6af0a03abdad4c8fcf',
  'percent-height-chain': 'f288d8e5e1e3d5b9d8caac4b7f7e89230c938d7cfb21f767e1d3496f74f06a8a',
  'margin-collapse-siblings': '56adcc075d70e8fb66fd1d49f05fd5af5588c4cce3318492996ac9c031db7729',
  'margin-collapse-parent-child': '399ab7f0868a989e86916550b8919ec834ba9776ca8cb74da90a5b12bb0ec2dd',
  'margin-collapse-through': '9b148e1f5ffc47646675b76054653ade9b18110d165bb57d6b4c6a82b94b8fbc',
  'margin-collapse-min-height': 'a4e4c7b438cc3070cf3a5e9205b7b5be83f510979ec7cdbf9fc3e4af463084bf',
  'margin-collapse-body': '3ae1dc05ef544874c8f98108a630d382370579890c6e97648934801ce76b5eee',
  'flex-auto-margins-main': 'd3e586dfd07d3f8c56987c8af9c551c5209f9bf17a5b745784f781982a2af2a8',
  'flex-auto-margins-cross': '521d1596343397e0d3ad3fd49a998d0654162b2331c0e79fc36fc9b178743a0e',
  'flex-auto-margins-negative': 'e6ece76b03047caeebc6af6c5de6e9ac5da145ccc46620663bf638bb71e2915a',
  'flex-align-content-remaining': 'a2bdd38ea54edbe44e8e4b28d8b3d77fabb0acf09d7f07f372e863732ab849c2',
  'flex-align-content-odd': '224abe81574c777776f709603c38a96bc98f983db1d6b45e112a097704544d8e',
  'flex-wrap-line-grow': '0551d5b781188b34cc9e427452ffa78e2eea31f64cf0d5761fee93bc4338c553',
  'flex-intrinsic-wrap-column': '88e76c9543d3219870d1fb04d8874a8c0ce6a79495822eddb3e33c1d0b7e3a8d',
  'intrinsic-percent': '21bb0765c8582edb04af2bfcae0c77db281d7b2e7b098abd3b6aa0186ea53737',
  'flex-nested': '24d47a9109a869e8d1d77466089e010d7520fbba7b827368bd0c8a1218dcc013',
  'flex-percent-definite': '4a96e74177702aa1850fbfbe8ba39eea51b94e891cad6d28983e82ad48f4584f',
  'flex-stretch-percent-minmax': '1f21858d52d89ebec6330eeb2d821ed2f08ef5715fe4d7095632c43d1760fc9d',
  'flex-distribution-grid': 'bd9bb86eb3e986d583103a3f287d0637262c19a67816ab8aade529e3aafe76a7',
  'text-wrap-spaces': '529f8832b5b35db52f30090f463f359fe25723f5b0e83d2eceed01a9f3da2625',
  'text-wrap-zwsp': '9a8c38e7fe98fbffa8be03b56ce7b8bf55c474dd8c2b7ba4bcb18537d2c92cc4',
  'text-align-multi-line': '191145c262340446de52126b8d3453446ed52342dd1300a96b03a5b42248c57a',
  'text-line-height-multi-line': '629150848bca1fab9d6dd04ec6fe7d9c9af1fd5e06d6d87122668df26842654b',
  'text-unbreakable-overflow': 'd6dd2003cd2053c478a3d00594998b541dab1cc0334514af7df20cd211a12147',
  'text-whitespace-collapse': 'f668c1e95763615e83d1448977e6521fe9cf9ac90d819af301f5bf351657d8ba',
  'text-anonymous-block-mixed': '55f017b76266c2b06b1ce2f810291fa4479fe91e23f3b96588dee9f1cc467fee',
  'flex-text-anonymous-item': '9acca675816adabbfcad437da6f6d312db9a344d73cd92e0c2127defe0e13e40',
  'flex-text-min-content-shrink': '0ed30f325fbc04fe9e2f2daac901ab1a7d556411c15fc37ff66063ae2884e36b',
  'flex-column-text-wrap': '01d1550cd50bfff227eef5e823a78c7c0a3de3679651a9ca8a4eb2eb5345e11d',
  'text-fractional-font-size': '4431582fb3ad2d1d3eb050132a980589b7bf400cbb806db4bf628e6c842cffcb',
  'rtl-block-auto-margins': '2a0020cdaa132a9107192179875272054b2d2274b72f9d424fe68aee2c61b576',
  'rtl-text-align-multi-line': 'c461b6144610d7e82bb28c7965f0af56bebbfb927caf6b84fcb794b08fe8865c',
  'rtl-flex-row-justify': 'fa757011c112044ae0ee4d19fe3fad59ca6f47c4485d137a3cd228bcebaefd38',
  'rtl-flex-wrap': '1d20d0caba74402bd901c730f70ca48c72990270a3434d2b8a54060418452ad0',
  'rtl-text-anonymous': 'e09a8b8b9714d9c7c76deff5030ea712c325196e2c3dbcb269ae393d07ed8961',
  'rtl-flex-column-align': 'fef9ce2ee122c3e89692d3b7893856e9acd2d958b52a05823750cd4d353e5d90',
  'direction-mixed-subtree': '9eb7ec00be3a5b792096a976a4d3bbc954870c8f88b944c27cf4b7ca483d4003',
  'flex-order': '9486d74d86f4bded77a7574ed87f02ae9d9f2ff5efcd36089b9b044861a9304d',
  'flex-row-reverse': 'c5f67c0360a3e153155a146ece33ba65b53dfca39200ea517018bdedf5914607',
  'flex-column-reverse': '1511745778290906e8bea6c7cf317fc1ca3cfa4f3d41796a09a182540ebc6881',
  'flex-reverse-start-end': '414f097bf60a49e8f8ecdc0a8a4a75bc6bd0802cc2f50748361b0d87e9eb6148',
  'flex-wrap-reverse': '8f65eb1e0f4fbba74c07549bfdef08067aed79d104e8be5c0a11413ca9c95214',
  'flex-baseline-text': '0c2a9408a29fa1a55a49fc40e404e483c58ce5d13fb81ef2d7b438060da57599',
  'flex-baseline-synthesized': '42f56b6eba144d797b16ed8f919a8f27c991b5803db459dedb3955f24602b7bf',
  'flex-baseline-nested': 'eed7795c85838217e59b1cf86c238f4c84a946324660f1b1dfb9cda829bfc85a',
  'flex-align-self-baseline-wrap': 'ff6dd6e5b16d9e292c574dcd5c38fbc66c19aa9347932b958f118052d83020ac',
  'flex-baseline-column-fallback': 'e361a8a18e2e89e6138b7f00f47772760eb97a7fca03c23e4558da335e2de9f7',
  'overflow-hidden-bfc': '1d3da8b3c700d4dab7396d714df81566db8cee2b7e64532a4d35300747401039',
  'overflow-hidden-flex-min-size': 'b8083eb60660643252b4e3d52be36222c52973c5b59c072cba30aea40d980e50',
  'position-relative-block': '659b6774c66e57b4cf33939f24332e161d271ec0f077724d5e51c3b8cc98b4b1',
  'position-relative-percent': '8d725b3b29fa497773bb13e8b92ccb603ec63fb983f4016ee712c5a23d09c7bb',
  'position-relative-flow': '5357c5a597760e8593f7d80a1c1a06669073fecbe4e0513dffde77dafa146239',
  'position-relative-flex': '160a2a2bb047f3da7f47c6328876c91d97caa98bcf00c4f386ac4c0437c9547c',
  'position-relative-flex-baseline': '244eb444ed3a0cef40706221e822a5484a73c3b79f4daf6472f0e860a05c5fcc',
  'position-absolute-containing-block': 'e66a74ef967475a7a6a09da97d95179cc9354038fc5da7590158fd03ecb62257',
  'position-absolute-static-block': '61547a7239f09c148ddc73c979112dc0af7991b5acb7b1b81e363b002f42d27f',
  'position-absolute-static-direction': '6a3bc0bf8454d568dbee9b37d7d73621088558cbbbbd7766fd062371d1650068',
  'position-absolute-initial-containing-block': 'c0e3dcd46e326ccb8935320e224b13f38038f46e6c5e0a74ebcb6823b9fbfdd1',
  'position-absolute-shrink-to-fit': '3ee2502d9cd40b21e398fb9e4c0837ef265c395df92ad7baeb9c1d68013319e5',
  'position-absolute-auto-margins': '332f9d24f28b66b387e103596caa75becab03b5888f9ce5814d0d5e07186c7ff',
  'position-absolute-over-constrained': 'aa183816528fa7a59d48f928f2e737edc6e2e2c19384481fd4e7f61b582c99fb',
  'position-absolute-min-max': 'b85f1dd2b92c3c6475f1023e5b1a7bf9957befeb9e85e2898d893988212e11bf',
  'position-absolute-height': '8d28b0dda4e0fce53c4ab44f731665acdf080c0e9c92963adeaffd4068dc12b3',
  'position-absolute-percent': '3f50c663a9fcae0d558fabd38ce10755cdc228eb0d0640169cb3921610c83891',
  'position-absolute-out-of-flow': '15b448bd3dbfb6c7999e727710cc9f90a578220b4cc3a859adf9ce65944fdc5e',
  'position-absolute-scroll-container': '7ac7067ac1904acd5284fabe75198da32f933bac7baa7282ecf21f777bb03e87',
  'position-absolute-flex-container': '997459063a2b09edcb40556b4cf0716baca5d9009537b6d53dd8bc2befb19d2f',
  'position-absolute-nested': 'dc6d2842f81dfb00fefc8738316afadd7a539d89637b8d8ab3eb879ccff347c7',
  'flex-abspos-justify': '546cb353149fd98d676d449ba204f54f242281f1c3c30f3aa2059ccf14b3dfce',
  'flex-abspos-align': 'c1590cd5a480773c4a3592035ad40fcb2a416e37b4de6bcbed131f99986b2f68',
  'flex-abspos-column': 'f6cae2b851d59b55378caade2747fe106e7d91622ae995a5f3895f2a4014a052',
  'flex-abspos-reverse': 'b87b1fd6f7d22bc2c64b9878d6ec91758fda30255cd8cfa4736fac88218f571e',
  'flex-abspos-wrap-reverse': 'a5728866574ea4e8a432f0b15aac9524b8a4639af650ece4f03f06697db4b1f1',
  'flex-abspos-center-shrink': '6a84d63fec95e2ff08462224132647bad137e227bb9fbd4a3c07d1ac56239b7e',
  'flex-abspos-insets': '5db748da5dda2a54ec27b5c2a49a0699ae03579c5851bc7fd2f58e703d5483a7',
  'flex-abspos-excluded': '73b1a0dd47d3efc5aea59b7e8c328d1ba55b9568f43577f298cb3de35bc9cdaf',
  'flex-baseline-nested-reverse': 'a056d8d9801934da9f2c4bde5d36e03dec258edc78d904e3dc5b04e68b6070d7',
  'flex-auto-margins-reverse-overflow': 'c10978ce401eaff7aaf1d3c7607e72f5718f6de12b345bb16ece7cb60302270b',
  'flex-order-baseline-wrap-reverse': '6a4333aec84379f012e48fcdc7460aacf7b99cf16fddda9676f9c43096a426a2',
  'flex-baseline-column-wrap-reverse': '4708ca139ca2bd5c823300cbb0b35f154bf4297387711c68d06f2db694f06955',
  'profile-initial-values-box': '3248e34d95dc9d9c02c75a64248769cf6b04d8238c1814580177c2c7f2d242d4',
  'profile-initial-values-text': 'fb21328f193cb176c71aa8b27f00cafdde1f94344a0fccfac3d32a399478651d',
  'gap-contexts': 'f5fc3d87e66b0f7ccd23a529a3c4f223fb375c282306577bc71702b9a2d4a108',
  'color-syntax-matrix': 'ef728b670d8e737b0448a1b194938356e04c5e90048b671966b8418dbb90cbd5',
  'baseline-source-matrix': '1c4842e5e1c064e0ca3b62f0f3de1e6b0539216a069ea4dbc382a538e8cd0a6e',
  'tree-switch-two-instances': '99d09e50367bc8f12da0935452138641d53ddd434cc0e868ddd946df05b7c81c',
  'tree-correlated-state': '064cd3ebf8a7eff5a4c47e41f18a03225f92a7b48e4e2236e5ec24594f91ae1e',
  'tree-controlled-aliases': '76b0ada886a25b7822ae56e1d02e853371bd4311b02998a363564f755c80e743',
  'tree-branch-arms': 'bc08e045e9eebdd44059064936c0cd57cf9dbe082d8c2fa4fd186af3d8bc440e',
  'tree-slot-projection': 'ceb6397b9e4ef118d3f4aa40e56f24b6de0bc36f61e591b595de7a28caa69eed',
  'tree-shared-class-one-module': '0bc6166731822b726e0a8cdf30fc194ba2fd9a9cb95afe235fe1591eb4293b18',
  'tree-colliding-modules': 'b593cc2aeb6b9f85f128ea11c7424e07cf4e2682ca3a9b5040b197ed5183a122',
  'tree-ordered-sheets': '8d0887f2db82f353e895feb7715226a25326ca5493becbbec58d8b423a917d14',
  'tree-ordered-sheets-reversed': '3ca1e7a6690e5ee937917da08fee6353d5867c5136fc60aa58a9345e5ecef908',
  'tree-param-args': '868edb103796116a0da7dec1ae2f0b59636a32f4337951baeda15a01f478ac95',
  'tree-nested-instances': '0983d5d05d28798f59b09aff48bef38d0d97ef660ccee656048f191b1ff312bc',
  'tree-attribute-equality': 'fb62fedb3fac7d635871bf7044809f1895764107373399888f12ef2b3c432ac2',
  'tree-projected-text': 'ed3f409eb82f900d01b1f5cd9e34613e50e38595f4a18b30e4e0ac735eb20ade',
  'tree-whitespace-leaves': 'cce481ccdf7dfb5941653603b184eba0cfeda5a46db0ec51b092e545ddceee00',
  'tree-position-toggle': 'c9876e975730ce83f4d8e541cd22f485661bd7fe39def4cc586636528e542574',
  'line-height-rounding': '45c27c7d17b0cbd7a9e3190acb66aaaf86a49bbc401178b6177ee52a39273364',
  'text-min-content-word-positions': '478d85020b8168fe46008ef5a6eba7eac96396ad1f6d90f6df1f9e1e0a8877a7',
  'border-initial-width': '9e07bfd2e100fed00f3f3369fd143bee10c9fe7cb4e4b93bc0ae4077846d4257',
  'reject-display-grid': 'baebb7fade0735cb1108ca46d1406f664b7f35b353965b48d2c066274b3d9593',
  'reject-color-lab': '507ab740076f98b7d570e9b5a384fa3fd279418810e6a9e3e7a428ca20ee6791',
  'reject-shorthand-filled': '929fae23d4efaefb8ba725bba705a24709d259812c2a7c81a27f818458c0a530',
  'reject-unproven-context': '66ddcd82bd0463273f08963ac70a057110ad8ccdfff1034347cce8cb34730e15',
  'reject-tree-alias-cycle': 'cf73d0abbf4bf5d893c07cae728d53800db0e1544053be3ee19fabaa7d43dc76',
  'reject-tree-choice-overlap': '8420246c4f491e46a727a9273593938cb55ba1c44bdb50523f02cfdf16417a05',
  'reject-tree-unknown-state': '299e60f6b0af5addb4d5e3faa657eb5d64eb88a29f9fec1fa7d20b1acf991d76',
  'reject-tree-initial-domain': 'ee2346c00698b6ba5d45473b3a8dbe6be5eef1cc54b24b33b563952d052cc68d',
  'reject-tree-producer-error': '8286d9c20e40b0632deb227c88d35020643a5a177f9130a73facbafcdf87e628',
  'reject-tree-raw-html': 'ea6e31c7e3c0b8af642fc0d8994eaa43b348694f672284525c0fb81e77029c41',
  'reject-white-space-pre': 'f16dd370d1092ba79e1685484a73e30fc1451ba280349cf85721cdf5f3fb0171',
  'reject-nesting-ampersand': '048160e10205de6e1585753e9fd40b730305fa5f581b807e44fccec2a6a72571',
  'reject-nested-media': '1e076c7e9cb8439eaef9d2d50f712827d3eac571f1252c1acd1f5eacfa240433',
  'reject-overflow-single-axis': 'bc77a13425f9144876b3cc5d3bbade19c5599d4281c4d3ea591fa8e139782ff2',
  'reject-overflow-body': 'cbd2d4e89553171876be9480bf141c9bc5c0bd3ca8af475f41432b4edec53b7e',
  'reject-overflow-scroll': '445da3315a73fb65d1cde80beb4feec749941dbc79a82f8b8edf24512a4da2fd',
  'reject-last-baseline': '1d68dfaa155975c8a9c6285983d8412b349e9e889652b73c7e2f194e03f7300d',
  'reject-bidi-neutral': '3f175bac3835c737299aa97ec10600faed2a712b73c792998f0a245ac40986c7',
  'reject-position-fixed': '97b74f97878066a40ac2aedb0bcb18f7103bffd7e68b4ad67527c9e1decee8b9',
  'reject-position-sticky': 'cc240935a181e255b4a7d93e58f24ce63f3fc053b55f14eee7ec960874e5695e',
  'reject-abspos-in-inline': '0df0160aca51b0bce5468bbc758c96a5fc932d12ceb71dca861a9aecb2af6d2a',
  'logical-margin-padding': 'e6abd3119b11edbd329ded96e426614ebbe950f51ea020879fa42f388b69f98f',
  'logical-border': 'e220a1846e09ce140d53b57a671884c365690f502017c884dd5965aab7b5d18e',
  'logical-inset': 'ef0b06aaafcc79773b117d72636e8c3b5aca9e6cc14add6ff256584745f45857',
  'logical-sizes': 'e19044dbecb7f7c5c9a44dcae2a06dd879181dd458a979cacc0f0d2b61aaaf8a',
  'logical-wide-keywords': 'd213125a92b8f2d37fd561a9b0c5712b7d80643ecfa42419882077c211b34833',
  'reject-writing-mode': '953ce88664f3bc630949497c6e1eaac4869c1d385e8b36bac0090cc26ae596f0',
  'reject-logical-radius': 'c83aa795afefe154bc5a1af1153f404342e87dd42c690d49244fb0cb3011298b',
  'background-shorthand-colors': '8ad92c7c8524a2e1911c72607a9e5784d887608505984c615b28b261b976c916',
  'background-shorthand-cascade': '0baed97d5a1281281ee22be0180c0e2f5d6992f1c808e7418f77b0c269e9ba4b',
  'reject-background-important': '9f86ae82dc143b834bcce9ef2c1fa3d77a22016843afdd7b47bb1b2fbde11bac',
  'reject-background-image': '5b4288061ca9d74407e0e6b9bb805dd68d1b1721939856093008a5e7fdcf7c0e',
  'reject-background-layers': '45ac655deeef48d31ba8f42f4733bc8e4da09727a6ca81bbefc6447efe03b36a',
  'selectors-universal-root': '6f1babba3914c3ec8245398b447889d37dc21dc3e8dc5c034d35f753a19bd9b6',
  'selectors-attribute': 'f26642a617ba27640e3960d36ebdf7cc464792660a47572d091133cda433c77b',
  'selectors-sibling': '333a0333da9a8fcf325ebc896df417f74d9b079738731c212b193a43d31329a4',
  'selectors-nth-child': 'af94a31bb7684990cfede67ff6a3298355fa8723cbeabc529c48a01e3c33b925',
  'selectors-nth-of-type': 'd31e7b223630c5657654355f68ac381817d6effde0425b059b0840b8899d9fb0',
  'selectors-logical': '7a79ca517c220a9f79f372905a56bce1389212b42aeeee3d3b9e9bb67f91b913',
  'selectors-has': 'a3d738d40ccc784deee974af35cabdcdcc261268464220570189d89b0b84ba7f',
  'selectors-specificity': '20378da1c27278de805dc05b9c47988a42a5f4aed544c2b800b5907d1f6fab06',
  'tree-selectors-state': '9bc6093a5b5cdf1e45d099d4c9dd7a405eae60c2f93c83762aa40ed4ab2d669c',
  'reject-selector-pseudo-element': 'cea20d4b12ad10e90b53008737757185978daf531a861bcac9f136d33e84efb9',
  'reject-selector-hover': 'c83130ffef3a77c5b72808f5446f34e99c9327805339e1c6aa47116c89ad682b',
  'reject-selector-s-flag': 'b2a9dd89bdf99d1901cef8bb1a428b41117545f96161008ff54f0e35ce4686bb',
  'reject-selector-nested-has': 'c94d96a43573619e0323c19ba17e1cb07b309bc7bd900bc564e69d96dd39bd01',
  'block-elements-defaults': '499b6507f93255cc26c160d97e1ae72143ef4ebbe4a5380d428a4e3f84d1ed7b',
  'block-elements-text': 'd66c06272f335c6e957bafb06cd4de33f1e03d79757ad5b4e6ee1496db3cfccb',
  'block-elements-font-size': 'f251c21ee7e208b8c9759d404ae8ed6f9b79712aadb87fdd1931673e06595fbe',
  'block-elements-margin-collapse': '3e5da34dff5576c47769bc223284251cfb141549d8d542260ecbe26960069cfb',
  'reject-ua-li-marker': '13ae5a50577d89a35c71aa2241b9bdea45fca1d7692088ff334f1c7d2bdd1b2c',
  'reject-ua-nested-list': '1a96957fe1d60e64706f2b053cf9e2b39072f1778f52afaefd57dc0d331becae',
  'reject-ua-hr-inset': '96704976184ae49ab2513482a6d2104b8efcd33ab817d3a71cf0e03be6095b4e',
  'reject-ua-min-font-size': 'e2d90a1a3c15c05d35871dc93b7f3060b6deb453128e9cc96156143793bd2ee9',
  'reject-element-pre': '94d13e146f5d37236a298f5e2fe672580b5da7aeae8d3d5631e8a01490d0d101',
  'units-absolute': 'b5ac0da406f74c9247d22f274460200e068ec903c12fa8443964f625be48f2d3',
  'units-em': '1c4a5f442f219036d07833fca0f81193c6c91f6738e7f62e9a656c6f9d08fafc',
  'units-rem': 'b6c03cc6d21c30fbdef738e39426ceaabe0001ba4d1762234760e6ec74c1ab09',
  'units-rem-root': '2dc49872148200a26ffd99ecab567d67a1ec825984ef665e72e90b87e2146f73',
  'units-rem-positioned': 'f3066be8ec2365b089e52c5195c215eca3bb4b352a7785ec2191e7d310538201',
  'reject-unit-vw': '0dac40432a6e8b5ce4b254b65f4f4e40c91b131483f9350f4f86f613d7640911',
  'reject-unit-ex': '5e3c022077f00d15ee18814dea325da1949a971df5f961e79b5032800422d735',
  'reject-unit-lh': 'e7dbd603cfd5869e8619fad4bf8cd26abbce2671c4561e94694e80785745174f',
  'reject-unit-calc': 'b27bd63a31d70dab60072d791fbcf7fae0bfe42db6b5bc8eb9f18582a5712cea',
  'context-absolute-in-flex-row': 'c2a2d5a283802341ad3c7c56feaa6e0041afe95ddebb75fcf6b069446eee2394',
  'context-relative-in-flex-row': 'dbe7a6d1457ccc27701109dc50a1e412dc893b809746dd8bdd0182fca5930ef1',
  'context-relative-in-flex-column': '5285148d8bbe93d0b67b49a5b2eeaa4137349d097ca1a56c31d7f3b169a27be7',
  'context-relative-in-block': '3bbf0bb4c0d40101bf67e8f265de98a889caa9d474a870d2abf3fbcaff1b4d62',
  'context-root-zero': '145141cd52420b81d0674cb6fd0494ed6361eb09587b51c9eb15ebd9bf982243',
  'context-root-box': 'ae570271e1604c8844062ed733984de94d61bc6ab5b8e3129d172e4e838906ef',
  'context-display-none': '809a88fdbe14fe8071c7b46c68680580b09e35232daf0777007044867efcaf8f',
  'context-not-flex-container': '67d5ffd2c20428c56ea55f0f34a3c2a19125b2c034b4db58cbc842ef458dc265',
  'context-text-align-flex-column': 'db10b412d182805613936eafc0f8ac3ceeecad09e5e1a28e9264608543470975',
  'context-block-insets': 'b172975793b49083d1e741b97ef9464b51ad65b3dd5c986c3668d983c691deb4',
  'context-flex-column-percent-width': '271ace3280e55f247c35ed1aff4ae084644e83b134458ef066cf0fca1e146c08',
  'reject-context-root-overflow': '354b98533eaeca9c4f4eb909b9095abfe032dba6b662aaef9e3e721f70b83c58',
};

const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

// BASE fixtures a later package removed on purpose, with their BASE text, so the reader is still checked on them.
// reject-background-important: casc-logical supports !important and replaced it with the layout fixture background-important.
const REMOVED_AFTER_BASE: Readonly<Record<string, string>> = {
  'reject-background-important': '<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; }\n.swatch { width: 20px; height: 20px; background: red !important; }\n</style>\n</head>\n<body data-dragon-id="body">\n<div data-dragon-id="swatch" class="swatch"></div>\n</body>\n</html>\n',
};

describe('fixture reader identity', () => {
  it('every fixture present at BASE reads to the byte-identical FrontEndResult', () => {
    expect(Object.keys(BASE_DIGESTS)).toHaveLength(195);
    for (const [id, expected] of Object.entries(BASE_DIGESTS)) {
      const spec = FIXTURES.find((f) => f.id === id);
      const removed = REMOVED_AFTER_BASE[id];
      if (removed !== undefined) {
        expect(spec, `${id} is listed as removed`).toBeUndefined();
        expect(existsSync(new URL(`../fixtures/${id}.html`, import.meta.url)), `${id} is listed as removed`).toBe(false);
        expect(digest(fixtureToInput(id, removed)), id).toBe(expected);
        continue;
      }
      if (spec === undefined) throw new Error(`BASE fixture ${id} is no longer registered`);
      const input = spec.format === 'html' ? readHtmlFixture(id).input : readTreeFixture(id);
      expect(digest(input), id).toBe(expected);
    }
  });

  it('the directory reader gives a parity tree fixture the same tree, sources and styles (only uris and paths differ)', () => {
    const id = 'tree-controlled-aliases';
    const a = readTreeFixture(id);
    const b = readTreeFixtureDir(`packages/parity/fixtures/${id}`, id);
    const strip = (x: unknown): string => canonicalJson(x).replace(/dragon-source:\/\/dragon-parity\/(packages\/parity\/)?fixtures\//g, '');
    expect(strip(b)).toBe(strip(a));
  });

  it('refuses a source outside the repository and an origin with a bad occurrence index', () => {
    const id = 'tree-controlled-aliases';
    const dir = `packages/parity/fixtures/${id}`;
    for (const bad of ['../../../../../x.css', '..\\..\\..\\..\\..\\x.css', '../../../../..']) {
      expect(() => readTreeFixtureDir(dir, id, { spec: (s) => ({ ...s, sources: [...s.sources, bad] }) }), bad).toThrow(/outside the repository/);
    }
    expect(() => readTreeFixtureDir(dir, id, { spec: (s) => ({ ...s, sources: [...s.sources, './fixture.json', 'fixture.json'] }) })).toThrow(/listed twice/);
    expect(() => readTreeFixtureDir(dir, id, { spec: (s) => ({ ...s, sources: [...s.sources, s.sources[0] as string] }) })).toThrow(/listed twice/);
    const at = (a: unknown) => (s: TreeFixtureFile): TreeFixtureFile => ({ ...s, components: s.components.map((c, i) => (i === 0 ? { ...c, at: a as TreeFixtureFile['components'][number]['at'] } : c)) });
    for (const bad of [['<', -1], ['<', 0.5], '']) expect(() => readTreeFixtureDir(dir, id, { spec: at(bad) }), JSON.stringify(bad)).toThrow(/bad origin/);
  });
});

const page = (head: string, body: string): string => `<!DOCTYPE html>\n<html data-dragon-id="html"><head>${head}</head><body data-dragon-id="body">${body}</body></html>\n`;

describe('HTML void elements', () => {
  it('are read without an end tag and with an immediate explicit one', () => {
    expect([...VOID_ELEMENTS].sort()).toEqual(['br', 'hr', 'img', 'input', 'link', 'meta']);
    const html = page('<meta charset="utf-8"><style>.a{}</style>', '<div data-dragon-id="d"><img data-dragon-id="i" src="x"><hr data-dragon-id="h"></hr><input data-dragon-id="n" type="range"><br data-dragon-id="b">t</div>');
    const { root } = parseFixtureHtml(html);
    const body = root.children.find((c) => 'tag' in c && c.tag === 'body') as { children: unknown[] };
    const div = body.children[0] as { children: ({ tag: string; children: unknown[] } | { text: string })[] };
    expect(div.children.map((c) => ('tag' in c ? `${c.tag}:${c.children.length}` : c.text))).toEqual(['img:0', 'hr:0', 'input:0', 'br:0', 't']);
    const tree = fixtureToInput('void', html).tree?.components[0]?.root[0];
    expect(JSON.stringify(tree)).toContain('"tag":"img"');
  });

  it('a void element may not hold content or close late', () => {
    expect(() => parseFixtureHtml(page('<style></style>', '<img data-dragon-id="i">x</img>'))).toThrow(/mismatched <\/img>/);
  });
});

describe('<link rel="stylesheet" href>', () => {
  const html = page('<meta charset="utf-8"><title>T</title><link rel="stylesheet" href="app.css">', '<div class="a" data-dragon-id="d"></div>');
  const css = '.a { width: 10px; }';
  const resolve = (href: string) => ({ text: href === 'app.css' ? css : '', uri: `dragon-source://p/${href}`, displayPath: `x/${href}` });

  it('resolves into a snapshot source and the document style use, with spans into the CSS file', () => {
    const input = fixtureToInput('linked', html, { resolveStylesheet: resolve });
    expect(input.snapshot.sources.map((s) => [s.ref.uri, s.displayPath])).toEqual([['dragon-source://dragon-parity/fixtures/linked.html', 'packages/parity/fixtures/linked.html'], ['dragon-source://p/app.css', 'x/app.css']]);
    const style = input.tree?.styles[0];
    expect(style?.css).toEqual({ source: input.snapshot.sources[1]?.ref, start: 0, end: css.length });
    expect(input.snapshot.sources[1]?.ref.hash).toBe(`sha256:${createHash('sha256').update(css).digest('hex')}`);
    expect(input.tree?.documents[0]?.styles).toEqual(['sheet']);
  });

  it('needs a resolver, and exactly one stylesheet', () => {
    expect(() => fixtureToInput('linked', html)).toThrow(/needs a stylesheet resolver/);
    expect(() => fixtureToInput('linked', html, { resolveStylesheet: () => ({ text: css, uri: 'dragon-source://dragon-parity/fixtures/linked.html', displayPath: 'x' }) })).toThrow(/fixture's own uri/);
    expect(() => parseFixtureHtml(page('<link rel="stylesheet" href="a.css"><style></style>', ''))).toThrow(/exactly one/);
    expect(() => parseFixtureHtml(page('', ''))).toThrow(/exactly one/);
    // rel is an ASCII case-insensitive token list, so neither link may be skipped silently.
    expect(() => parseFixtureHtml(page('<link rel="Stylesheet" href="a.css"><style></style>', ''))).toThrow(/exactly one/);
    expect(() => parseFixtureHtml(page('<link rel="alternate stylesheet" href="a.css"><style></style>', ''))).toThrow(/only rel="stylesheet"/);
  });
});
