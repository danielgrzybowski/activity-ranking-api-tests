@rankings @contract
Feature: The shape of a seven-day activity ranking

  Once a place is chosen the user gets one screen: seven days, four
  activities per day, each with a suitability and a plain-English reason.
  These scenarios pin down what that screen can rely on, independently of
  what the weather happens to be.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Chamonix-Mont-Blanc" is a "MILD_OVERCAST_DAY"

  @smoke
  Scenario: A ranking covers seven days and all four activities
    When I request rankings for location id "3333129"
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers 7 consecutive days starting from the first forecast day
    And every day ranks all four activities:
      | SKIING              |
      | SURFING             |
      | OUTDOOR_SIGHTSEEING |
      | INDOOR_SIGHTSEEING  |

  Scenario: Each entry carries everything a card in the UI has to render
    When I request rankings for location id "3333129"
    Then every activity entry has a date, an activity name, a suitability score and a rating
    And every reasoning is at most 160 characters
    And every reasoning refers to at least one weather driver

  Scenario: Ranks run 1 to 4 in descending order of suitability
    When I request rankings for location id "3333129"
    Then every day numbers its activities 1 to 4 with no gaps or duplicates
    And within each day a better score never has a worse rank

  # Without a stated tie-break, two equally-good activities would swap places
  # between refreshes and the list would look unstable to the user.
  Scenario: Equal scores are broken alphabetically so ranks never wobble
    When I request rankings for location id "3333129"
    Then activities tied on score are ordered alphabetically

  Scenario: The rating label always agrees with the score
    When I request rankings for location id "3333129"
    Then every rating matches the documented band for its score

  Scenario: The resolved location is echoed back so the user can confirm it
    When I request rankings for location id "3333129"
    Then the resolved location is "Chamonix-Mont-Blanc, Auvergne-Rhone-Alpes, France"
    And the resolved location id is "3333129"

  Scenario: Units are stated, so numbers in the reasoning are unambiguous
    When I request rankings for location id "3333129"
    Then the response declares units for temperature, precipitation, snowfall and wind speed

  Scenario: The forecast is attributed and timezone-stamped
    When I request rankings for location id "3333129"
    Then the forecast source is "open-meteo"
    And the forecast timezone is "Europe/Paris"

  Scenario Outline: A shorter window can be requested
    When I request rankings for location id "3333129" over <days> days
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers <days> consecutive days starting from the first forecast day

    Examples:
      | days |
      | 1    |
      | 3    |
      | 7    |

  Scenario Outline: A day count outside the supported window is rejected
    When I request rankings for location id "3333129" over "<days>" days
    Then the response status is 400
    And the error code is "INVALID_DAYS"

    Examples:
      | days |
      | 0    |
      | 8    |
      | -3   |
      | week |

  # The same forecast must produce the same ranking, or nothing downstream
  # (caching, screenshots, a user comparing two tabs) can be trusted.
  Scenario: The same request twice gives the same answer
    When I request rankings for location id "3333129"
    And I request rankings for location id "3333129" again
    Then both responses are identical apart from the generation timestamp

  Scenario: Responses are cacheable, so a repeat visit is cheap
    When I request rankings for location id "3333129"
    Then the response status is 200
    And the "cache-control" header contains "max-age"
    And the "content-type" header contains "application/json"

  Scenario: The response is usable from a browser front end
    When I request rankings for location id "3333129"
    Then the "access-control-allow-origin" header is present

  @performance
  Scenario: Rankings arrive inside the spinner budget
    When I request rankings for location id "3333129"
    Then the response status is 200
    And the response arrived within the "rankings" latency budget
