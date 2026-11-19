// Fictional demo family. Nothing here is real.

const P = (id, en, ka, fr, gender, birth, death = '', extra = {}) =>
  ({ id, name: { en, ka, fr }, gender, birth, death, parents: [], partners: [], ...extra });

export function sampleFamily() {
  const people = [
    // Paternal side (Beridze)
    P('ilia', 'Ilia Beridze', 'ილია ბერიძე', 'Ilia Béridzé', 'm', '1905-03-14', '1980-10-02'),
    P('keti', 'Ketevan Beridze', 'ქეთევან ბერიძე', 'Kétévan Béridzé', 'f', '1908-07-22', '1985-01-11'),
    P('levan', 'Levan Beridze', 'ლევან ბერიძე', 'Lévan Béridzé', 'm', '1932-11-27', '2001-05-30'),
    P('nino', 'Nino Beridze', 'ნინო ბერიძე', 'Nino Béridzé', 'f', '1935-12-04', '2015-08-19'),
    P('davit', 'Davit Beridze', 'დავით ბერიძე', 'Davit Béridzé', 'm', '1958-06-09'),
    P('tamar', 'Tamar Kapanadze', 'თამარ კაპანაძე', 'Tamar Kapanadzé', 'f', '1960-02-17'),
    P('giorgi', 'Giorgi Beridze', 'გიორგი ბერიძე', 'Guiorgui Béridzé', 'm', '1961-11-23'),
    P('ana', 'Ana Beridze', 'ანა ბერიძე', 'Ana Béridzé', 'f', '1965-09-01'),
    P('pierre', 'Pierre Dubois', 'პიერ დიუბუა', 'Pierre Dubois', 'm', '1962-04-12'),
    P('luka', 'Luka Beridze', 'ლუკა ბერიძე', 'Louka Béridzé', 'm', '1985-12-08'),
    P('salome', 'Salome Beridze', 'სალომე ბერიძე', 'Salomé Béridzé', 'f', '1989-03-30'),
    P('hugo', 'Hugo Dubois', 'უგო დიუბუა', 'Hugo Dubois', 'm', '1992-07-14'),
    P('lea', 'Lea Dubois', 'ლეა დიუბუა', 'Léa Dubois', 'f', '1996-01-25'),

    // Maternal side (Martin)
    P('jean', 'Jean Martin', 'ჟან მარტენი', 'Jean Martin', 'm', '1935-05-05', '2010-03-03'),
    P('marie', 'Marie Martin', 'მარი მარტენი', 'Marie Martin', 'f', '1940-12-21'),
    P('claire', 'Claire Martin', 'კლერ მარტენი', 'Claire Martin', 'f', '1964-08-18'),

    // You, your sibling, your partner and child
    P('alex', 'Alex Beridze', 'ალექსანდრე ბერიძე', 'Alexandre Béridzé', 'm', '1993-04-16'),
    P('mariam', 'Mariam Beridze', 'მარიამ ბერიძე', 'Mariam Béridzé', 'f', '1997-11-29'),
    P('sophie', 'Sophie Lefevre', 'სოფი ლეფევრი', 'Sophie Lefèvre', 'f', '1994-12-02'),
    P('elene', 'Elene Beridze', 'ელენე ბერიძე', 'Hélène Béridzé', 'f', '2022-06-21'),

    // Partner's side (Lefevre)
    P('bernard', 'Bernard Lefevre', 'ბერნარ ლეფევრი', 'Bernard Lefèvre', 'm', '1938-02-08', '2019-09-14'),
    P('jacqueline', 'Jacqueline Lefevre', 'ჟაკლინ ლეფევრი', 'Jacqueline Lefèvre', 'f', '1941-10-10'),
    P('paul', 'Paul Lefevre', 'პოლ ლეფევრი', 'Paul Lefèvre', 'm', '1964-01-19'),
    P('isabelle', 'Isabelle Lefevre', 'იზაბელ ლეფევრი', 'Isabelle Lefèvre', 'f', '1966-12-15'),
    P('anne', 'Anne Roux', 'ან რუ', 'Anne Roux', 'f', '1968-05-28'),
    P('marc', 'Marc Roux', 'მარკ რუ', 'Marc Roux', 'm', '1965-11-30'),
    P('thomas', 'Thomas Lefevre', 'ტომა ლეფევრი', 'Thomas Lefèvre', 'm', '1997-08-07'),
    P('julien', 'Julien Roux', 'ჟულიენ რუ', 'Julien Roux', 'm', '1995-11-21'),
    P('camille', 'Camille Roux', 'კამილ რუ', 'Camille Roux', 'f', '1999-02-03'),
  ];
  const by = Object.fromEntries(people.map((p) => [p.id, p]));
  const couple = (a, b) => { by[a].partners.push(b); by[b].partners.push(a); };
  const kids = (a, b, ...children) => children.forEach((c) => { by[c].parents = [a, b]; });

  couple('ilia', 'keti'); kids('ilia', 'keti', 'levan');
  couple('levan', 'nino'); kids('levan', 'nino', 'davit', 'giorgi', 'ana');
  couple('davit', 'tamar'); kids('davit', 'tamar', 'luka', 'salome');
  couple('ana', 'pierre'); kids('ana', 'pierre', 'hugo', 'lea');
  couple('jean', 'marie'); kids('jean', 'marie', 'claire');
  couple('giorgi', 'claire'); kids('giorgi', 'claire', 'alex', 'mariam');
  couple('alex', 'sophie'); kids('alex', 'sophie', 'elene');
  couple('bernard', 'jacqueline'); kids('bernard', 'jacqueline', 'paul', 'anne');
  couple('paul', 'isabelle'); kids('paul', 'isabelle', 'sophie', 'thomas');
  couple('anne', 'marc'); kids('anne', 'marc', 'julien', 'camille');

  return { version: 1, people, startPerson: 'alex' };
}
