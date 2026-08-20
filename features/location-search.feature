@locations @contract
Feature: Finding the city or town to plan around

  Every journey through this product starts with someone typing a place name.
  The API has to cope with half-typed input, with the many places that share
  a name, and with nothing matching at all - without ever making a typeahead
  throw an error at a user who is simply still typing.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains:
      | id      | name                | region               | country        | countryCode | latitude | longitude | timezone         | population |
      | 2643743 | London              | England              | United Kingdom | GB          | 51.50853 | -0.12574  | Europe/London    | 8961989    |
      | 6058560 | London              | Ontario              | Canada         | CA          | 42.98339 | -81.23304 | America/Toronto  | 346765     |
      | 4517009 | London              | Ohio                 | United States  | US          | 39.88645 | -83.44825 | America/New_York | 10060      |
      | 2657896 | Zürich              | Zurich               | Switzerland    | CH          | 47.36667 | 8.55      | Europe/Zurich    | 341730     |
      | 3333129 | Chamonix-Mont-Blanc | Auvergne-Rhone-Alpes | France         | FR          | 45.92375 | 6.86933   | Europe/Paris     | 8611       |

  @smoke
  Scenario: A full place name resolves to that place
    When I search for locations matching "Chamonix-Mont-Blanc"
    Then the response status is 200
    And the response matches the locations contract
    And the search returns 1 result
    And the search results include "Chamonix-Mont-Blanc, Auvergne-Rhone-Alpes, France"

  Scenario: A partial name returns every candidate, most prominent first
    When I search for locations matching "Lond"
    Then the response status is 200
    And the search returns 3 results
    And the search results are, in order:
      | displayName                     |
      | London, England, United Kingdom |
      | London, Ontario, Canada         |
      | London, Ohio, United States     |

  # Three real Londons exist. A picker that shows "London" three times is a
  # dead end, so the API - not the front end - owns the disambiguating label.
  Scenario: Places that share a name are still told apart
    When I search for locations matching "London"
    Then every result has a distinct display name
    And every result has its own coordinates, country and timezone

  Scenario Outline: Search ignores case and accents
    When I search for locations matching "<query>"
    Then the response status is 200
    And the search results include "<displayName>"

    Examples:
      | query  | displayName                     |
      | zürich | Zürich, Zurich, Switzerland     |
      | zurich | Zürich, Zurich, Switzerland     |
      | ZURICH | Zürich, Zurich, Switzerland     |
      | london | London, England, United Kingdom |
      | LoNdOn | London, England, United Kingdom |

  # A typeahead that 404s would flash an error on every unfinished word.
  Scenario: A place nobody has heard of returns an empty list, not an error
    When I search for locations matching "Qwertyville"
    Then the response status is 200
    And the response matches the locations contract
    And the search returns 0 results
    And the response body carries no error

  Scenario: The echoed query lets the front end discard stale responses
    When I search for locations matching "Lond"
    Then the echoed query is "Lond"

  Scenario: Suggestions can be capped to fit a dropdown
    When I search for locations matching "Lond" with a limit of 2
    Then the response status is 200
    And the search returns 2 results

  Scenario Outline: Queries too short to be worth a lookup are rejected
    When I search for locations matching "<query>"
    Then the response status is 400
    And the error code is "INVALID_QUERY"
    And the error message explains the minimum query length

    Examples:
      | query |
      |       |
      | L     |

  Scenario: A query of nothing but whitespace is rejected
    When I search for locations matching "   "
    Then the response status is 400
    And the error code is "INVALID_QUERY"

  Scenario: A missing query parameter is rejected
    When I request locations with no query parameter
    Then the response status is 400
    And the error code is "INVALID_QUERY"

  Scenario Outline: A nonsensical limit is rejected rather than silently clamped
    When I search for locations matching "Lond" with a limit of "<limit>"
    Then the response status is 400
    And the error code is "INVALID_QUERY"

    Examples:
      | limit |
      | 0     |
      | 21    |
      | -1    |
      | many  |

  # Forecast calls cost quota. Searching is not forecasting.
  Scenario: Searching does not touch the forecast service
    When I search for locations matching "Lond"
    Then Open-Meteo's forecast service was not called
    And Open-Meteo's geocoding service was called

  @performance
  Scenario: Typeahead stays inside its latency budget
    When I search for locations matching "Lon"
    Then the response status is 200
    And the response arrived within the "locations" latency budget
