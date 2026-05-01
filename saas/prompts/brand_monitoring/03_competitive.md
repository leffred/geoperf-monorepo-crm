# Catégorie 3 — Recherche concurrentielle (10 prompts)

> Variables utilisées : `{competitors[0]}`, `{competitors[1]}`, `{brand}`
> 3 prompts (4, 9, 10) utilisent `{brand}` directement → biais positif sur citation_rate, gardés pour mesurer le **positioning** et le **share-of-voice quand on parle explicitement de la marque**.

```
1. Quels sont les principaux concurrents de {competitors[0]} dans le {category} ?

2. Comparaison entre {competitors[0]} et {competitors[1]} en {category} : forces, faiblesses, positionnement.

3. Quelles alternatives sérieuses à {competitors[0]} pour un client B2B en {category} ?

4. Quelles alternatives à {brand} en {category} ? Cite 5 sociétés concurrentes avec leurs spécificités.

5. Je travaille avec {competitors[0]}, mais je souhaite diversifier mon portefeuille. Quelles sociétés équivalentes me suggères-tu en {category} ?

6. {competitors[0]} vs {competitors[1]} en {category} : laquelle est la plus pertinente pour un grand compte ?

7. Quelles entreprises rivalisent directement avec {competitors[0]} en {category} aujourd'hui, en France et à l'international ?

8. Si tu devais identifier un challenger sérieux à {competitors[0]} en {category}, qui serait-ce et pourquoi ?

9. Top 5 des sociétés à considérer face à {brand} en {category}, avec un argumentaire pour chacune.

10. {brand} a-t-elle des concurrents qui la dépassent en {category} sur certains segments ? Si oui, lesquels et sur quel critère ?
```
