# Solell

Les factures de casa (Solell 19) en una pàgina: llum, aigua i telèfon, què es
paga cada mes i com canvia d'un any a l'altre.

**https://roninsilent.github.io/solell/**

## Com funciona

`index.html` és tota l'app: un sol fitxer, sense cap pas de compilació ni cap
dependència més enllà de la lletra de Google Fonts i l'entrada amb Google.

Les dades no es toquen des d'aquí. Cada dilluns al matí una tasca automàtica
mira els correus de les companyies, desa els PDF al Drive de casa i hi deixa
un fitxer `solell-factures.json`. L'app només el llegeix.

- Entra-hi amb **roninsilent@gmail.com**; qualsevol altre compte el rebutja.
- El permís que demana és `drive.file`: només veu els fitxers que ha creat
  ella mateixa. Per això, la primera vegada que s'hi entra crea el
  `solell-factures.json` buit, i a partir d'aquell moment la tasca setmanal ja
  el pot omplir.
- Els PDF viuen a `Compartit Anna/Solell 19/Factures`, una subcarpeta per tipus.

## Pestanyes

| | |
|---|---|
| Resum | què ha costat la casa els últims 12 mesos i què hi falta |
| Llum | kWh comprats i abocats a la xarxa, i l'import de cada mes |
| Aigua | consum i import de cada trimestre |
| Telèfon | l'import de cada mes |
| Totes | la llista sencera, amb cercador i enllaç al PDF |

## Resum del matí

`mati.html` ensenya el resum que es genera cada matí a les 6:54: el temps dels
tres llocs, l'agenda, qui treballa i els missatges que demanen resposta. Llegeix
`solell-resum-mati.json` del mateix Drive i en guarda els últims catorze dies.

El resum el redacta en Gemini i arriba com una pàgina sencera d'HTML. L'app no
l'enganxa tal qual: n'extreu el bloc `.shell`, el torna a muntar etiqueta per
etiqueta amb una llista del que hi pot haver i descarta la resta, de manera que
ni un `<script>` ni un `onclick` ni un enllaç que no sigui `https:` o `mailto:`
hi poden entrar.
