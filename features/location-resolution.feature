@rankings @errors @contract
Feature: Turning what the user typed into the place we rank

  A ranking request can name a place two ways: the id the user picked from
  the search results, or the raw city name they typed. The id is exact. The
  name is not, and the API has to be honest about that rather than guessing
  and quietly ranking the wrong continent.

  None of the answers below is worth a forecast call either: quota spent
  before a place has even been settled on is quota spent on nothing.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Paris" is "PERFECT_SUMMER_DAY"

  @smoke
  Scenario: An id taken from the search results is one the ranking accepts
    The seam between the two endpoints, and the path every user takes: this is
    the only scenario proving an id the search handed out is an id the ranking
    accepts.

    When I search for locations matching "Chamonix"
    And I request rankings for the first search result
    Then the response status is 200
    And the response matches the rankings contract
    And the resolved location is "Chamonix, Rhône-Alpes, France"

  Scenario: An unambiguous city name works without a search round trip
    When I request rankings for the city "Paris"
    Then the response status is 200
    And the resolved location is "Paris, Ile-de-France, France"

  Scenario: City names are matched without regard to case or accents
    When I request rankings for the city "zurich"
    Then the response status is 200
    And the resolved location is "Zürich, Zurich, Switzerland"

  Scenario: A town whose airfield shares its name still resolves without asking
    A small town with an airstrip nearby comes back as two matches, and the
    city shortcut then reports it as ambiguous between the town and its own
    landing pad. Zermatt, Reykjavik, Newquay, Innsbruck and Kitzbuhel all did
    before airfields were filtered out - a third of the resort names checked
    against the live service.

    When I request rankings for the city "Zermatt"
    Then the response status is 200
    And the resolved location is "Zermatt, Valais, Switzerland"

  Scenario: An ambiguous city name asks the user to choose
    Silently picking the biggest London would eventually rank Ontario's
    weather for someone standing in England. The API asks instead, and hands
    back everything a picker needs so there is no second round trip.

    When I request rankings for the city "London"
    Then the response status is 409
    And the error code is "AMBIGUOUS_LOCATION"
    And the error details list the candidate locations
    And Open-Meteo's forecast service was not called

  Scenario: A city nobody has heard of is a clear not-found
    When I request rankings for the city "Qwertyville"
    Then the response status is 404
    And the error code is "LOCATION_NOT_FOUND"
    And the error message mentions "Qwertyville"
    And the response matches the error contract
    And Open-Meteo's forecast service was not called

  Scenario: An unknown location id is a clear not-found
    When I request rankings for location id "99999999"
    Then the response status is 404
    And the error code is "LOCATION_NOT_FOUND"
    And Open-Meteo's forecast service was not called

  Scenario Outline: A request that does not name one place is rejected, not guessed at
    When I request rankings <request>
    Then the response status is 400
    And the error code is "<code>"

    Examples:
      | request                                         | code                        |
      | with no location                                | MISSING_LOCATION            |
      | for location id "2988507" and the city "London" | CONFLICTING_LOCATION_PARAMS |
      | for the city "P"                                | INVALID_QUERY               |

  Scenario: A parameter supplied twice is rejected rather than guessed at
    A caller that sends `city` twice is confused about its own request. Taking
    the first and ranking Paris answers plausibly enough that nobody looks
    again, and the front-end bug behind it reaches users intact.

    When I request rankings with the raw query string "city=Paris&city=Rome"
    Then the response status is 400
    And the error code is "INVALID_QUERY"
    And the response matches the error contract

  # These go out verbatim rather than through the encoder: a raw NUL byte is
  # the one that tends to crash a parser, and "%00" as a query parameter is
  # only ever the three characters.
  Scenario Outline: Hostile input is handled, not crashed on
    Injection-shaped input should come back as a plain not-found, not a 500.

    When I request rankings with the raw query string "<query>"
    Then the response status is one of "400, 404"
    And the response matches the error contract

    Examples:
      | query                                  |
      | city=%3Cscript%3Ealert(1)%3C/script%3E |
      | city=%27%20OR%201%3D1%20--             |
      | city=../../etc/passwd                  |
      | city=Par%00is                          |
