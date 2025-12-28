
export const MEDIA_FIELDS = `
    id
    idMal
    title {
      romaji
      english
      native
    }
    type
    format
    status
    description
    startDate { year month day }
    endDate { year month day }
    season
    seasonYear
    episodes
    duration
    chapters
    volumes
    countryOfOrigin
    source
    coverImage { extraLarge large medium }
    bannerImage
    genres
    averageScore
    popularity
    relations {
      edges {
        relationType
        node {
          id
          title { romaji }
          type
        }
      }
    }
`;

// Lighter version for high-speed ghosting
export const LIGHT_MEDIA_FIELDS = `
    id
    title { romaji english }
    type
    format
    status
    season
    seasonYear
    episodes
    coverImage { large }
    averageScore
    popularity
`;

export function generateBatchQuery(ids: number[], deep = true) {
  let query = 'query {\n';
  const fields = deep ? MEDIA_FIELDS : LIGHT_MEDIA_FIELDS;
  ids.forEach(id => {
    query += `  m${id}: Media(id: ${id}) { ${fields} }\n`;
  });
  query += '}';
  return query;
}

export const ANIME_QUERY = `query($id: Int) { Media(id: $id) { ${MEDIA_FIELDS} } }`;
