'use strict';
// Read-only ActiveSkills/shred excerpts from the supplied 2026-10-05 workbooks.
// Thai and German originals carry distinct English versions; retain each as-is.
const thaiEnglish='[Shapeshift] into a [Werewolf] and lash out with a flurry of claw swipes. The first [Attack] can dash to faraway enemies and the final [Attack] [Strike|Strikes] twice. [Attack|Attacking] a [Frozen] enemy will create [IceFragment|Ice Fragments], which are [Projectile|Projectiles] that land and explode after a short delay.';
const germanEnglish='[Shapeshift] into a [Werewolf] and lash out with a flurry of claw swipes. The first [Attack] can dash to faraway enemies and the final [Attack] [Strike|Strikes] twice. [Attack|Attacking] a [Frozen] enemy will [Trigger] [IceFragment|Ice Fragments].';
const germanTarget='[Shapeshift|Verwandelt] Euch in einen [Werewolf|Werwolf] und schlagt um Euch mit einer Vielzahl von Klauenhieben. Über den ersten [Attack|Angriff] kann man sich auf weit entfernte Gegner stürzen und der finale [Attack|Angriff] [Strike|schlägt] doppelt zu. Einen [Frozen|eingefrorenen] Gegner [Attack|anzugreifen] [Trigger|löst] [IceFragment|Eisfragmente] aus.';
const thaiKeywords=['[Shapeshift]','[Werewolf]','[Attack]','[Attack]','[Strike|Strikes]','[Attack|Attacking]','[Frozen]','[IceFragment|Ice Fragments]','[Projectile|Projectiles]'];
const germanEnglishKeywords=['[Shapeshift]','[Werewolf]','[Attack]','[Attack]','[Strike|Strikes]','[Attack|Attacking]','[Frozen]','[Trigger]','[IceFragment|Ice Fragments]'];
const germanKeywords=['[Shapeshift|Verwandelt]','[Werewolf|Werwolf]','[Attack|Angriff]','[Attack|Angriff]','[Strike|schlägt]','[Frozen|eingefrorenen]','[Attack|anzugreifen]','[Trigger|löst]','[IceFragment|Eisfragmente]'];
const dictionary=[
    {_id:'shift',find:'Shapeshift',replace:'Verwandelt',alts:[]},
    {_id:'wolf',find:'Werewolf',replace:'Werwolf',alts:[]},
    {_id:'attack',find:'Attack',replace:'Angriff',alts:[{_id:'attacking',find:'Attacking',replace:'anzugreifen'}]},
    {_id:'strike',find:'Strike',replace:'Schlag',alts:[{_id:'strikes',find:'Strikes',replace:'schlägt'}]},
    {_id:'frozen',find:'Frozen',replace:'eingefrorenen',alts:[]},
    {_id:'trigger',find:'Trigger',replace:'löst',alts:[]},
    {_id:'ice',find:'IceFragment',replace:'Eisfragment',alts:[{_id:'ices',find:'Ice Fragments',replace:'Eisfragmente'}]},
    {_id:'projectile',find:'Projectile',replace:'Projektil',alts:[{_id:'projectiles',find:'Projectiles',replace:'Projektile'}]},
];
module.exports={thaiEnglish,germanEnglish,germanTarget,thaiKeywords,germanEnglishKeywords,germanKeywords,dictionary};
